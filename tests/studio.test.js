// Template Studio tests: team access, making and checking templates,
// review and publishing, shops wearing a Studio template, hiding, deleting.
//
//   npm run test:studio
//
// Same rules as the other suites: MONGO_URI_TEST must be a throwaway database
// whose name contains "test". It is wiped.
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (p) => import(pathToFileURL(path.join(root, p)).href)
dotenv.config({ path: path.join(root, '.env') })
Object.assign(process.env, {
  JWT_SECRET: 'x'.repeat(40),
  SETTINGS_ENCRYPTION_KEY: 'k'.repeat(40),
  PLATFORM_DOMAIN: 'shopsy.ng',
  NODE_ENV: 'production',
  PLAN_BASIC_PRICE: '5000',
  PLAN_PRO_PRICE: '12000',
  RESEND_API_KEY: 'test',
  BREVO_API_KEY: '',
  VERCEL_TOKEN: 'vercel-test-token',
  VERCEL_PROJECT_ID: 'prj_test',
})

// ---------- fake Vercel ----------
const vercel = []
function fakeVercel(method, url, body) {
  vercel.push({ method, url, body })
  return { name: body?.name, verified: true }
}
const mg = await import('mongoose')
const mongoose = mg.default
const FAKE = typeof mg.__reset === 'function'
let server
if (FAKE) {
  globalThis.__axios = async (method, url, body) => ({ data: fakeVercel(method, url, body) })
  process.env.VERCEL_API_URL = 'https://vercel.test'
} else {
  const uri = process.env.MONGO_URI_TEST || ''
  if (!uri || !/test/i.test(uri.split('?')[0].split('/').pop() || '')) {
    console.error('Set MONGO_URI_TEST to a throwaway database whose name contains "test". It will be wiped.')
    process.exit(1)
  }
  await mongoose.connect(uri)
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(fakeVercel(req.method.toLowerCase(), req.url, raw ? JSON.parse(raw) : undefined)))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.VERCEL_API_URL = `http://127.0.0.1:${server.address().port}`
}
const emails = []
globalThis.fetch = async (url, opts) => (emails.push(JSON.parse(opts.body)), { ok: true, text: async () => '' })

const Store = (await imp('models/Store.js')).default
const User = (await imp('models/User.js')).default
const Product = (await imp('models/Product.js')).default
const Settings = (await imp('models/Settings.js')).default
const { resolveStore, storeOpen, forgetStore } = await imp('middleware/storeMiddleware.js')
const { protect, admin } = await imp('middleware/authMiddleware.js')
const PL = await imp('controllers/platformController.js')
const F = await imp('controllers/founderController.js')
const SC = await imp('controllers/studioController.js')
const S = await imp('controllers/settingsController.js')
const { forgetTemplates } = await imp('utils/templates.js')
const { seedDemos } = await imp('scripts/seedDemos.js')

let passed = 0
const failures = []
const check = async (n, f) => { try { await f(); passed++ } catch (e) { failures.push(`${n}: ${e.message}`) } }
function request({ host, token, body = {}, params = {}, query = {}, url = '/api/x' }) {
  const headers = {}
  if (host) headers['x-store-host'] = host
  if (token) headers.authorization = `Bearer ${token}`
  return { headers, body, params, query, ip: '1.1.1.1', path: url.replace(/^\/api/, ''), originalUrl: url, get(h) { return headers[h.toLowerCase()] } }
}
function response() {
  const r = { statusCode: 200 }
  r.status = (c) => ((r.statusCode = c), r)
  r.json = (b) => ((r.body = JSON.parse(JSON.stringify(b ?? null))), r)
  return r
}
async function run(chain, opts, shop = true) {
  const req = request(opts)
  const res = response()
  for (const fn of [...(shop ? [resolveStore, storeOpen] : []), ...chain]) {
    let next = false
    await fn(req, res, () => (next = true))
    if (!next) break
  }
  return res
}

const studio = (fn, token, opts = {}) => run([PL.platformProtect, SC.studioAccess, fn], { token, ...opts }, false)
const founder = (fn, token, opts = {}) => run([PL.platformProtect, F.superadminOnly, fn], { token, ...opts }, false)

if (FAKE) mg.__reset()
else {
  await mongoose.connection.dropDatabase()
  for (const m of Object.values(mongoose.models)) await m.syncIndexes()
}
forgetStore()
forgetTemplates()

await seedDemos({ email: 'founder@shopsy.ng', password: 'founder-pass-1234', log: () => {} })
const login = async (email, password) => (await run([PL.login], { body: { email, password } }, false)).body.token
const founderTok = await login('founder@shopsy.ng', 'founder-pass-1234')
const signup = async (name, shopName, template) =>
  (await run([PL.signup], { body: { acceptTerms: true, name, email: `${name}@x.ng`, password: `${name}-pass-123`, shopName, template } }, false)).body
const dayo = await signup('dayo', 'Dayo Designs')
const merchant = await signup('mike', 'Mike Shop')

const recipe = {
  brand: '#B8860B', ink: '#111111', surface: '#FAF7F0', headingFont: 'playfair', bodyFont: 'epilogue', radius: 'square',
  uppercase: false, headingWeight: 500, layout: { card: 'centered', grid: 'grid', columns: 3, footer: 'dark', hero: 'full', search: false },
}
const luxe = { key: 'luxe', label: 'Luxe', bestFor: 'Jewellery and luxury', description: 'Black and gold.', sampleSet: 'fresh', recipe }
let luxeId

await check('the Studio is for the team: visitors 401, ordinary merchants 403', async () => {
  assert.equal((await studio(SC.listStudio, undefined)).statusCode, 401)
  assert.equal((await studio(SC.listStudio, dayo.account.token)).statusCode, 403)
  assert.equal((await studio(SC.listStudio, founderTok)).statusCode, 200)
})
await check('the founder adds a designer by email; only platform accounts', async () => {
  assert.equal((await founder(F.addDesigner, founderTok, { body: { email: 'nobody@x.ng' } })).statusCode, 404)
  const shop = await Store.findOne({ slug: 'mike-shop' })
  await User.create({ store: shop._id, role: 'customer', name: 'Cust', email: 'cust@x.ng', password: 'cust-pass-12' })
  assert.equal((await founder(F.addDesigner, founderTok, { body: { email: 'cust@x.ng' } })).statusCode, 404, 'shop customers are not platform accounts')
  const r = await founder(F.addDesigner, founderTok, { body: { email: 'DAYO@x.ng' } })
  assert.equal(r.statusCode, 200)
  assert.equal(r.body.designer, true)
  assert.equal((await founder(F.addDesigner, dayo.account.token, { body: { email: 'mike@x.ng' } })).statusCode, 403, 'designers cannot add people')
  const team = (await founder(F.listTeam, founderTok)).body
  assert.deepEqual(team.map((u) => u.email).sort(), ['dayo@x.ng', 'founder@shopsy.ng'])
  assert.equal((await studio(SC.listStudio, dayo.account.token)).statusCode, 200)
  const me = (await run([PL.platformProtect, PL.getMe], { token: dayo.account.token }, false)).body
  assert.equal(me.account.designer, true)
})
await check('templates are checked: short name and every part', async () => {
  const bad = async (patch) => (await studio(SC.createStudio, dayo.account.token, { body: { ...luxe, ...patch } })).statusCode
  assert.equal(await bad({ key: 'classic' }), 400)
  assert.equal(await bad({ key: 'Luxe Gold!' }), 400)
  assert.equal(await bad({ label: '' }), 400)
  assert.equal(await bad({ recipe: { ...recipe, brand: 'gold' } }), 400)
  assert.equal(await bad({ recipe: { ...recipe, layout: { ...recipe.layout, card: 'spinning' } } }), 400)
  assert.equal(await bad({ recipe: { ...recipe, headingFont: 'comic-sans' } }), 400)
  assert.equal(await bad({ recipe: { ...recipe, layout: { ...recipe.layout, columns: 9 } } }), 400)
})
await check('a designer makes a template: it starts as a draft', async () => {
  const r = await studio(SC.createStudio, dayo.account.token, { body: luxe })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  assert.equal(r.body.status, 'draft')
  assert.equal(r.body.recipe.brand, '#b8860b')
  assert.equal(r.body.createdByName, 'dayo')
  luxeId = r.body._id
  assert.equal((await studio(SC.createStudio, founderTok, { body: luxe })).statusCode, 400, 'short name taken')
})
await check("drafts aren't in the gallery and can't be chosen", async () => {
  assert.deepEqual((await run([PL.getStudioGallery], {}, false)).body, [])
  const s = await signup('ngozi', 'Ngozi Rings', 'luxe')
  const settings = await Settings.findOne({ store: s.shop._id })
  assert.equal(settings.theme.template, 'classic')
  const host = `${s.shop.slug}.shopsy.ng`
  const r = await run([protect, admin, S.saveDraft], { host, token: s.account.token, body: { theme: { template: 'luxe' } } })
  assert.equal(r.statusCode, 400)
})
await check('review, then only the founder can publish', async () => {
  assert.equal((await studio(SC.setStudioStatus, dayo.account.token, { params: { id: luxeId }, body: { status: 'review' } })).body.status, 'review')
  assert.equal((await studio(SC.setStudioStatus, dayo.account.token, { params: { id: luxeId }, body: { status: 'published' } })).statusCode, 403)
  const r = await studio(SC.setStudioStatus, founderTok, { params: { id: luxeId }, body: { status: 'published' } })
  assert.equal(r.body.status, 'published')
  assert.match(r.body.demoUrl, /demo-luxe/)
})
await check('published: in the gallery with its recipe, and a demo shop with the chosen sample products', async () => {
  const g = (await run([PL.getStudioGallery], {}, false)).body
  assert.deepEqual(g.map((t) => t.id), ['luxe'])
  assert.equal(g[0].recipe.layout.card, 'centered')
  const demos = (await run([PL.getDemos], {}, false)).body
  assert.ok(demos.some((d) => d.template === 'luxe'))
  const demo = await Store.findOne({ slug: 'demo-luxe' })
  assert.ok(demo.isDemo)
  const names = (await Product.find({ store: demo._id })).map((p) => p.name)
  assert.ok(names.includes('Party Jollof Rice'), 'food samples (sampleSet: fresh)')
})
let ada
await check('a merchant starts with it: the storefront gets the recipe', async () => {
  ada = await signup('ada', 'Ada Jewels', 'luxe')
  const host = `${ada.shop.slug}.shopsy.ng`
  const settings = (await run([S.getSettings], { host, token: ada.account.token })).body
  assert.equal(settings.theme.template, 'luxe')
  assert.deepEqual(settings.theme.recipe.layout, { ...recipe.layout, nav: 'standard', home: 'sections' })
  const saved = await Settings.findOne({ store: ada.shop._id }).lean()
  assert.equal(saved.theme.recipe, undefined, 'the recipe is never copied into the shop')
})
await check('sample product pictures show a drawing of the product', async () => {
  const p = await Product.findOne({ store: ada.shop._id, name: 'Party Jollof Rice' })
  assert.ok(decodeURIComponent(p.image).includes('🍛'))
})
await check('only the founder edits a published template; the change reaches shops at once', async () => {
  const changed = { ...luxe, key: 'renamed', recipe: { ...recipe, brand: '#000000' } }
  assert.equal((await studio(SC.updateStudio, dayo.account.token, { params: { id: luxeId }, body: changed })).statusCode, 403)
  const r = await studio(SC.updateStudio, founderTok, { params: { id: luxeId }, body: changed })
  assert.equal(r.statusCode, 200)
  assert.equal(r.body.key, 'luxe', 'the short name never changes')
  const settings = (await run([S.getSettings], { host: `${ada.shop.slug}.shopsy.ng`, token: ada.account.token })).body
  assert.equal(settings.theme.recipe.brand, '#000000')
  assert.equal((await studio(SC.getStudio, founderTok, { params: { id: luxeId } })).body.shops, 1)
})
await check('hidden: out of the gallery, not for new shops, but shops already using it keep it', async () => {
  await studio(SC.setStudioStatus, founderTok, { params: { id: luxeId }, body: { status: 'hidden' } })
  assert.deepEqual((await run([PL.getStudioGallery], {}, false)).body, [])
  const late = await signup('late', 'Late Shop', 'luxe')
  assert.equal((await Settings.findOne({ store: late.shop._id })).theme.template, 'classic')
  const host = `${ada.shop.slug}.shopsy.ng`
  assert.equal((await run([S.getSettings], { host, token: ada.account.token })).body.theme.recipe.brand, '#000000')
  const r = await run([protect, admin, S.saveDraft], { host, token: ada.account.token, body: { theme: { template: 'luxe', brandColor: '#222222' } } })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
})
await check("can't delete or un-publish a template shops are using; drafts can be deleted", async () => {
  assert.equal((await studio(SC.deleteStudio, founderTok, { params: { id: luxeId } })).statusCode, 400)
  assert.equal((await studio(SC.setStudioStatus, founderTok, { params: { id: luxeId }, body: { status: 'draft' } })).statusCode, 400)
  const d = await studio(SC.createStudio, dayo.account.token, { body: { ...luxe, key: 'scratch', label: 'Scratch' } })
  assert.equal((await studio(SC.deleteStudio, dayo.account.token, { params: { id: d.body._id } })).statusCode, 200)
})
await check('removing a designer closes the Studio to them', async () => {
  const dayoUser = await User.findOne({ email: 'dayo@x.ng', store: null })
  await founder(F.removeDesigner, founderTok, { params: { id: String(dayoUser._id) } })
  assert.equal((await studio(SC.listStudio, dayo.account.token)).statusCode, 403)
})
await check('seed-demos also rebuilds demos for published Studio templates', async () => {
  await studio(SC.setStudioStatus, founderTok, { params: { id: luxeId }, body: { status: 'published' } })
  const made = await seedDemos({ email: 'founder@shopsy.ng', password: '', log: () => {} })
  assert.ok(made.some((s) => s.slug === 'demo-luxe'))
  assert.equal(made.length, 11)
})

await check('page structure: menu and homepage parts (pack ids allowed), banner split/none; bad ids refused', async () => {
  const body = { ...luxe, key: 'structured', label: 'Structured', recipe: { ...recipe, layout: { ...recipe.layout, nav: 'search', home: 'spotlight', hero: 'none' } } }
  const r = await studio(SC.createStudio, founderTok, { body })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  assert.equal(r.body.recipe.layout.nav, 'search')
  assert.equal(r.body.recipe.layout.home, 'spotlight')
  assert.equal(r.body.recipe.layout.hero, 'none')
  const bad = async (layout) => (await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'bad-structure', recipe: { ...recipe, layout: { ...recipe.layout, ...layout } } } })).statusCode
  assert.equal(await bad({ nav: '<script>' }), 400)
  assert.equal(await bad({ home: 'Has Spaces' }), 400)
  assert.equal(await bad({ hero: 'video-wall' }), 400)
})
await check('the rest of the shop: rows, categories, reviews, product page, shop pages, spacing; left out when not given', async () => {
  const layout = { ...recipe.layout, rows: 'shelf', categories: 'circles', quotes: 'single', product: 'sticky', listing: 'sidebar', density: 'compact', bands: true, dividers: false }
  const r = await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'round-two', label: 'Round two', recipe: { ...recipe, layout } } })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  const l = r.body.recipe.layout
  assert.deepEqual([l.rows, l.categories, l.quotes, l.product, l.listing, l.density, l.bands, l.dividers], ['shelf', 'circles', 'single', 'sticky', 'sidebar', 'compact', true, false])
  const plain = await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'round-two-plain', label: 'Plain', recipe } })
  assert.equal(plain.statusCode, 201)
  for (const k of ['rows', 'categories', 'quotes', 'product', 'listing', 'density', 'bands', 'dividers']) assert.equal(k in plain.body.recipe.layout, false, k)
  const bad = async (extra) => (await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'bad-round-two', recipe: { ...recipe, layout: { ...recipe.layout, ...extra } } } })).statusCode
  assert.equal(await bad({ rows: 'carousel3d' }), 400)
  assert.equal(await bad({ product: '<b>' }), 400)
  assert.equal(await bad({ listing: 'masonry' }), 400)
  assert.equal(await bad({ density: 7 }), 400)
})
await check('Gadget and Atelier are built-in templates with electronics and fashion products', async () => {
  const g = await signup('gadgetshop', 'Gadget Shop', 'gadget')
  assert.equal((await Settings.findOne({ store: g.shop._id })).theme.template, 'gadget')
  assert.ok((await Product.find({ store: g.shop._id })).some((p) => p.name === 'Wireless Earbuds'))
  const a = await signup('ateliershop', 'Atelier Shop', 'atelier')
  assert.ok((await Product.find({ store: a.shop._id })).some((p) => p.name === 'Silk Scarf'))
})

// ---------- real photos ----------
const HeroSlide = (await imp('models/HeroSlide.js')).default
const photo = (n) => `https://res.cloudinary.com/test/image/upload/platform/templates/${n}.jpg`
await check('photo addresses are checked; only the chosen sample products get slots', async () => {
  const bad = async (pictures) => (await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'pics-bad', pictures } })).statusCode
  assert.equal(await bad({ hero: 'http://insecure.test/a.jpg' }), 400)
  assert.equal(await bad({ hero: 'javascript:alert(1)' }), 400)
  const r = await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'photo-shop', label: 'Photo Shop', sampleSet: 'fresh', pictures: { hero: photo('hero'), products: { 'Party Jollof Rice': photo('jollof'), 'Not A Sample': photo('x') } } } })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  assert.deepEqual(Object.keys(r.body.pictures.products), ['Party Jollof Rice'])
  await studio(SC.setStudioStatus, founderTok, { params: { id: r.body._id }, body: { status: 'published' } })
})
await check('new shops (and the demo) start with the real photos; drawn pictures fill the rest', async () => {
  const s = await signup('photoowner', 'Photo Owner', 'photo-shop')
  const jollof = await Product.findOne({ store: s.shop._id, name: 'Party Jollof Rice' })
  assert.equal(jollof.image, photo('jollof'))
  const zobo = await Product.findOne({ store: s.shop._id, name: 'Chilled Zobo' })
  assert.match(zobo.image, /^data:image\/svg/)
  assert.equal((await HeroSlide.findOne({ store: s.shop._id })).mediaUrl, photo('hero'))
  const demo = await Store.findOne({ slug: 'demo-photo-shop' })
  assert.equal((await Product.findOne({ store: demo._id, name: 'Party Jollof Rice' })).image, photo('jollof'))
})
await check('uploading a template photo returns its address', async () => {
  if (!FAKE) return // never uploads to the real Cloudinary from tests
  const r = await studio(SC.uploadStudioPicture, founderTok, {})
  assert.equal(r.statusCode, 400)
  const ok = await run([PL.platformProtect, SC.studioAccess, (req, res, next) => ((req.file = { buffer: Buffer.from('x') }), next()), SC.uploadStudioPicture], { token: founderTok }, false)
  assert.match(ok.body.url, /^https:\/\/res\.cloudinary\.com\/.+platform\/templates/)
})

// ---------- "My own products" ----------
const Category = (await imp('models/Category.js')).default
const farm = {
  key: 'farm-fresh', label: 'Farm Fresh', bestFor: 'Farm produce', sampleSet: 'custom', recipe,
  samples: {
    heading: 'Straight from the farm',
    text: 'Harvested this week',
    categories: [{ label: 'Vegetables' }, { label: 'Grains & Tubers' }, { label: 'Vegetables' }],
    products: [
      { name: 'Fresh Tomatoes (Basket)', price: 18000, category: 'Vegetables', description: 'Ripe, firm and red.', image: photo('tomato') },
      { name: 'Yam Tubers (5)', price: '12000', category: 'grains-tubers' },
      { name: 'Ugu Leaves', price: 1500, category: 'Unknown' },
    ],
  },
}
await check('own products are checked: a category, a product, prices, unique names, safe photos', async () => {
  const bad = async (samples) => (await studio(SC.createStudio, founderTok, { body: { ...farm, key: 'farm-bad', samples } })).statusCode
  assert.equal(await bad({ categories: [], products: farm.samples.products }), 400)
  assert.equal(await bad({ categories: farm.samples.categories, products: [] }), 400)
  assert.equal(await bad({ categories: farm.samples.categories, products: [{ name: 'Yam', price: 'lots' }] }), 400)
  assert.equal(await bad({ categories: farm.samples.categories, products: [{ name: 'Yam', price: 1 }, { name: 'Yam', price: 2 }] }), 400)
  assert.equal(await bad({ categories: farm.samples.categories, products: [{ name: 'Yam', price: 1, image: 'http://x.test/a.jpg' }] }), 400)
})
await check("own products: categories (the shop menu), products, prices and photos go into new shops", async () => {
  const r = await studio(SC.createStudio, founderTok, { body: farm })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  assert.deepEqual(r.body.samples.categories.map((c) => c.label), ['Vegetables', 'Grains & Tubers'], 'duplicates dropped')
  assert.equal(r.body.samples.products[2].category, 'vegetables', 'unknown category -> the first one')
  await studio(SC.setStudioStatus, founderTok, { params: { id: r.body._id }, body: { status: 'published' } })
  const g = (await run([PL.getStudioGallery], {}, false)).body.find((t) => t.id === 'farm-fresh')
  assert.equal(g.samples.products.length, 3)
  const shop = await signup('farmer', 'Farmer Joe', 'farm-fresh')
  const cats = (await Category.find({ store: shop.shop._id })).map((c) => c.label).sort()
  assert.deepEqual(cats, ['Grains & Tubers', 'Vegetables'])
  const products = await Product.find({ store: shop.shop._id })
  assert.deepEqual(products.map((p) => p.name).sort(), ['Fresh Tomatoes (Basket)', 'Ugu Leaves', 'Yam Tubers (5)'])
  assert.equal(products.find((p) => p.name.startsWith('Fresh Tomatoes')).image, photo('tomato'))
  assert.equal(products.find((p) => p.name.startsWith('Yam')).price, 12000)
  assert.match(products.find((p) => p.name === 'Ugu Leaves').image, /^data:image\/svg/, 'no photo: a drawn picture')
  assert.equal((await HeroSlide.findOne({ store: shop.shop._id })).heading, 'Straight from the farm')
  assert.equal((await run([S.getSettings], { host: `${shop.shop.slug}.shopsy.ng`, token: shop.account.token })).body.theme.samples.categories.length, 2)
})

await check('saving a published template rebuilds its demo shop straight away', async () => {
  const t = await (await imp('models/StudioTemplate.js')).default.findOne({ key: 'farm-fresh' })
  const body = { ...farm, samples: { ...farm.samples, products: [{ name: 'Sweet Plantain (Bunch)', price: 3000, category: 'Vegetables', image: photo('plantain') }] } }
  const r = await studio(SC.updateStudio, founderTok, { params: { id: String(t._id) }, body })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  const demo = await Store.findOne({ slug: 'demo-farm-fresh' })
  const names = (await Product.find({ store: demo._id })).map((p) => p.name)
  assert.deepEqual(names, ['Sweet Plantain (Bunch)'])
  assert.equal((await Product.findOne({ store: demo._id })).image, photo('plantain'))
})

// ---------- private templates and shops made for clients ----------
const vip = { ...luxe, key: 'vip-amaka', label: 'Amaka VIP', visibility: 'private', allowedEmails: 'VIP@x.ng, second@x.ng' }
let vipId
await check('private templates: emails checked; out of the gallery; no public demo', async () => {
  assert.equal((await studio(SC.createStudio, founderTok, { body: { ...vip, key: 'vip-bad', allowedEmails: 'not-an-email' } })).statusCode, 400)
  const r = await studio(SC.createStudio, founderTok, { body: vip })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  assert.deepEqual(r.body.allowedEmails, ['vip@x.ng', 'second@x.ng'])
  vipId = r.body._id
  const p = await studio(SC.setStudioStatus, founderTok, { params: { id: vipId }, body: { status: 'published' } })
  assert.equal(p.body.demoUrl, null)
  assert.equal(await Store.exists({ slug: 'demo-vip-amaka' }), null)
  assert.ok(!(await run([PL.getStudioGallery], {}, false)).body.some((t) => t.id === 'vip-amaka'))
  assert.ok(!(await run([PL.getDemos], {}, false)).body.some((d) => d.template === 'vip-amaka'))
})
await check('only the chosen emails can start a shop with a private template', async () => {
  const other = await signup('stranger', 'Stranger Shop', 'vip-amaka')
  assert.equal((await Settings.findOne({ store: other.shop._id })).theme.template, 'classic')
  const vipUser = (await run([PL.signup], { body: { acceptTerms: true, name: 'Vip', email: 'vip@x.ng', password: 'vip-pass-1234', shopName: 'Vip Shop', template: 'vip-amaka' } }, false)).body
  assert.equal((await Settings.findOne({ store: vipUser.shop._id })).theme.template, 'vip-amaka')
  // switching in the builder: others can't, the owner keeps theirs
  const r = await run([protect, admin, S.saveDraft], { host: `${other.shop.slug}.shopsy.ng`, token: other.account.token, body: { theme: { template: 'vip-amaka' } } })
  assert.equal(r.statusCode, 400)
  const ok = await run([protect, admin, S.saveDraft], { host: `${vipUser.shop.slug}.shopsy.ng`, token: vipUser.account.token, body: { theme: { template: 'vip-amaka', brandColor: '#123456' } } })
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body))
})
await check('an edited built-in is always public', async () => {
  const r = await studio(SC.createStudio, founderTok, { body: { builtIn: 'glow', label: 'Glow', recipe, visibility: 'private', allowedEmails: 'a@b.ng' } })
  assert.equal(r.body.visibility, 'public')
  await studio(SC.deleteStudio, founderTok, { params: { id: r.body._id } })
})
let clientInvite
await check('founder makes a shop for a new client: their own account, the private template, an invite', async () => {
  emails.length = 0
  assert.equal((await founder(F.createClientShop, dayo.account.token, { body: {} })).statusCode, 403)
  assert.equal((await founder(F.createClientShop, founderTok, { body: { name: 'Bisi', email: 'bad', shopName: 'X' } })).statusCode, 400)
  assert.equal((await founder(F.createClientShop, founderTok, { body: { name: 'Bisi', email: 'second@x.ng', shopName: 'Bisi Bags', template: 'nope' } })).statusCode, 400)
  const r = await founder(F.createClientShop, founderTok, { body: { name: 'Bisi', email: 'Second@x.ng', shopName: 'Bisi Bags', template: 'vip-amaka' } })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  assert.equal(r.body.invited, true)
  const client = await User.findOne({ store: null, email: 'second@x.ng' })
  assert.equal(client.role, 'merchant')
  assert.equal(client.termsAcceptedAt ?? null, null)
  const store = await Store.findById(r.body.shopId)
  assert.equal(String(store.owner), String(client._id))
  assert.equal((await Settings.findOne({ store: store._id })).theme.template, 'vip-amaka')
  await new Promise((resolve) => setTimeout(resolve, 20))
  const mail = emails.find((e) => /Bisi Bags/.test(e.subject))
  clientInvite = mail.html.match(/reset-password\/([0-9a-f]+)\?invite=1/)[1]
  assert.ok(r.body.inviteUrl.endsWith(`/reset-password/${clientInvite}?invite=1`), 'the founder gets the same link to share')
  assert.ok(clientInvite)
  const log = await (await imp('models/PlatformAction.js')).default.findOne({ action: 'create-for-client' })
  assert.match(log.details, /second@x\.ng \(new account, invite sent\)/)
})
await check('the client accepts the terms when setting their password, then signs in', async () => {
  const noTerms = await run([PL.resetPassword], { body: { token: clientInvite, password: 'bisi-pass-1234' } }, false)
  assert.equal(noTerms.statusCode, 400)
  assert.equal(noTerms.body.field, 'terms')
  const ok = await run([PL.resetPassword], { body: { token: clientInvite, password: 'bisi-pass-1234', acceptTerms: true } }, false)
  assert.equal(ok.statusCode, 200)
  assert.ok((await User.findOne({ store: null, email: 'second@x.ng' })).termsAcceptedAt)
  assert.equal((await run([PL.login], { body: { email: 'second@x.ng', password: 'bisi-pass-1234' } }, false)).statusCode, 200)
})
await check('an existing account gets the new shop, no invite; a taken address gets the next free one', async () => {
  emails.length = 0
  const r = await founder(F.createClientShop, founderTok, { body: { name: 'Bisi', email: 'second@x.ng', shopName: 'Bisi Bags', template: 'classic' } })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  assert.equal(r.body.existingAccount, true)
  assert.equal(r.body.invited, false)
  assert.equal(r.body.slug, 'bisi-bags-2')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(emails.length, 0)
  assert.equal(await Store.countDocuments({ owner: (await User.findOne({ store: null, email: 'second@x.ng' }))._id }), 2)
})

// ---------- editing a built-in template ----------
let freshEdit
const freshShop = await signup('fola', 'Fola Foods', 'fresh')
const freshHost = `${freshShop.shop.slug}.shopsy.ng`
const freshTheme = async () => (await run([S.getSettings], { host: freshHost, token: freshShop.account.token })).body.theme
await check('edit a built-in: one edited version, made like any template, not live until published', async () => {
  await founder(F.addDesigner, founderTok, { body: { email: 'dayo@x.ng' } })
  const r = await studio(SC.createStudio, dayo.account.token, { body: { builtIn: 'fresh', label: 'Fresh', bestFor: 'Food', sampleSet: 'fresh', recipe: { ...recipe, brand: '#15803d' }, pictures: { products: { 'Chilled Zobo': photo('zobo') } } } })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  assert.equal(r.body.builtIn, 'fresh')
  freshEdit = r.body._id
  assert.equal((await studio(SC.createStudio, founderTok, { body: { builtIn: 'fresh', label: 'Again', recipe } })).statusCode, 400)
  assert.equal((await studio(SC.createStudio, founderTok, { body: { builtIn: 'nope', label: 'X', recipe } })).statusCode, 400)
  assert.equal((await freshTheme()).recipe, undefined, 'draft: shops keep the original')
  const odd = await signup('odd', 'Odd Shop', 'builtin-fresh')
  assert.equal((await Settings.findOne({ store: odd.shop._id })).theme.template, 'classic', 'the edit is not a separate template')
})
await check('published: every shop on that built-in gets the new look, the gallery and demo too', async () => {
  await studio(SC.setStudioStatus, dayo.account.token, { params: { id: freshEdit }, body: { status: 'review' } })
  const r = await studio(SC.setStudioStatus, founderTok, { params: { id: freshEdit }, body: { status: 'published' } })
  assert.equal(r.body.status, 'published')
  assert.equal(r.body.shops >= 1, true)
  assert.equal((await freshTheme()).recipe.brand, '#15803d')
  const g = (await run([PL.getStudioGallery], {}, false)).body
  assert.equal(g.find((t) => t.id === 'fresh')?.builtIn, 'fresh')
  const demo = await Store.findOne({ slug: 'demo-fresh' })
  assert.equal((await Product.findOne({ store: demo._id, name: 'Chilled Zobo' })).image, photo('zobo'))
  const odd2 = await signup('odd2', 'Odd Two', 'builtin-fresh')
  assert.equal((await Settings.findOne({ store: odd2.shop._id })).theme.template, 'classic', 'still not a separate template once published')
  assert.ok(!(await run([PL.getStudioGallery], {}, false)).body.some((t) => t.id === 'builtin-fresh'))
  const s = await signup('newfresh', 'New Fresh', 'fresh')
  assert.equal((await Product.findOne({ store: s.shop._id, name: 'Chilled Zobo' })).image, photo('zobo'))
})
await check('reset to original: only the founder, and everything goes back', async () => {
  assert.equal((await studio(SC.deleteStudio, dayo.account.token, { params: { id: freshEdit } })).statusCode, 403)
  const r = await studio(SC.deleteStudio, founderTok, { params: { id: freshEdit } })
  assert.equal(r.statusCode, 200)
  assert.equal((await freshTheme()).recipe, undefined)
  assert.ok(!(await run([PL.getStudioGallery], {}, false)).body.some((t) => t.id === 'fresh'))
  const demo = await Store.findOne({ slug: 'demo-fresh' })
  assert.match((await Product.findOne({ store: demo._id, name: 'Chilled Zobo' })).image, /^data:image\/svg/)
})

// ---------- homepage content and button words ----------
const settingsOf = async (shop) => Settings.findOne({ store: shop._id })
await check('a new shop starts with its template\'s own homepage and banner words (food: "Order now")', async () => {
  const s = await signup('chef', 'Mama Put', 'fresh')
  const set = await settingsOf(s.shop)
  const ids = set.homeSections.map((x) => x.id)
  assert.deepEqual(ids.slice(0, 3), ['hero', 's-menu', 's-how'])
  assert.equal(set.homeSections[1].data.title, "Today's menu")
  assert.equal(set.homeSections[1].data.category, 'meals')
  const slide = await HeroSlide.findOne({ store: s.shop._id })
  assert.equal(slide.heading, 'Hot meals from Mama Put')
  assert.equal(slide.buttonLabel, 'Order now')
  const classic = await settingsOf((await signup('tee', 'Tee Shop', 'classic')).shop)
  const banner = classic.homeSections.find((x) => x.type === 'banner')
  assert.match(banner.data.image, /^data:image\/svg/, 'an empty picture is filled in')
  assert.notDeepEqual(classic.homeSections.map((x) => x.id), ids, 'templates start differently')
})
await check('Studio content: checked, saved, and used by new shops with the shop name filled in', async () => {
  const content = {
    hero: { heading: 'Fresh coffee at {shop}', text: 'Brewed to order', buttonLabel: 'Order now', buttonLink: '/category/drinks' },
    homeSections: [
      { id: 'hero', type: 'hero', enabled: true, data: {} },
      { id: 'menu-row', type: 'products', enabled: true, data: { title: 'Our menu', source: 'category', category: 'drinks', count: 6, layout: 'carousel' } },
      { id: 'about-us', type: 'text', enabled: true, data: { heading: 'About {shop}', text: 'Since 2019.', align: 'left' } },
      { id: 'promo-one', type: 'banner', enabled: true, data: { heading: 'Happy hour', text: '', buttonLabel: 'See deals', buttonLink: '/shop', image: '' } },
      { id: 'gone-cat', type: 'products', enabled: true, data: { title: 'Pastries', source: 'category', category: 'pastries', count: 4 } },
    ],
  }
  const bad = async (c) => (await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'cafe-bad', content: c } })).statusCode
  assert.equal(await bad({ homeSections: [{ type: 'popup', data: {} }] }), 400)
  assert.equal(await bad({ homeSections: [{ type: 'banner', data: { buttonLink: 'javascript:alert(1)' } }] }), 400)
  assert.equal(await bad({ homeSections: [{ type: 'text', data: { heading: 'x'.repeat(200) } }] }), 400)
  assert.equal(await bad('nope'), 400)
  const r = await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'cafe', label: 'Cafe', recipe: { ...recipe, words: { add: 'Add to order', buy: 'Order now' } }, content } })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  assert.equal(r.body.content.homeSections.length, 5)
  assert.equal(r.body.content.hero.heading, 'Fresh coffee at {shop}')
  assert.deepEqual(r.body.recipe.words, { add: 'Add to order', buy: 'Order now' })
  assert.equal(r.body.previewSlug, 'demo-fresh', 'previewed in the demo with the same sample products')
  await studio(SC.setStudioStatus, founderTok, { params: { id: r.body._id }, body: { status: 'published' } })
  const s = await signup('barista', 'Bean Bar', 'cafe')
  const set = await settingsOf(s.shop)
  assert.deepEqual(set.homeSections.map((x) => x.id), ['hero', 'menu-row', 'about-us', 'promo-one', 'gone-cat'])
  assert.equal(set.homeSections[2].data.heading, 'About Bean Bar')
  assert.match(set.homeSections[3].data.image, /^data:image\/svg/)
  assert.equal(set.homeSections[4].data.source, 'newest', 'a category the shop lacks shows the newest products')
  const slide = await HeroSlide.findOne({ store: s.shop._id })
  assert.deepEqual([slide.heading, slide.buttonLabel, slide.buttonLink], ['Fresh coffee at Bean Bar', 'Order now', '/category/drinks'])
  const theme = (await run([S.getSettings], { host: `${s.shop.slug}.shopsy.ng`, token: s.account.token })).body.theme
  assert.deepEqual(theme.recipe.words, { add: 'Add to order', buy: 'Order now' })
})
await check('button words: 24 characters, plain text; a shop can set its own', async () => {
  const bad = async (w) => (await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'words-bad', recipe: { ...recipe, words: w } } })).statusCode
  assert.equal(await bad({ add: 'x'.repeat(25) }), 400)
  assert.equal(await bad({ buy: '<b>Buy</b>' }), 400)
  const s = await signup('wordy', 'Wordy Shop', 'classic')
  const host = `${s.shop.slug}.shopsy.ng`
  const save = (theme) => run([protect, admin, S.saveDraft], { host, token: s.account.token, body: { theme } })
  assert.equal((await save({ addLabel: 'Add to basket', buyLabel: 'Grab it' })).statusCode, 200)
  assert.equal((await save({ addLabel: 'y'.repeat(30) })).statusCode, 400)
  assert.equal((await save({ buyLabel: '<script>' })).statusCode, 400)
  await run([protect, admin, S.publishDraft], { host, token: s.account.token })
  const theme = (await run([S.getSettings], { host, token: s.account.token })).body.theme
  assert.deepEqual([theme.addLabel, theme.buyLabel], ['Add to basket', 'Grab it'])
})
await check('the Studio gets every built-in homepage, the sample categories, and the demo shops for previews', async () => {
  const o = (await studio(SC.studioOptions, founderTok)).body
  assert.equal(o.builtInContent.fresh.hero.buttonLabel, 'Order now')
  assert.deepEqual(o.sampleCategories.fresh.map((c) => c.name), ['meals', 'drinks', 'small-chops'])
  assert.ok(o.demoSlugs.includes('demo-classic') && o.demoSlugs.includes('demo-tech'))
})
await check('a template with its own products gets a preview shop while being made; deleting removes it', async () => {
  const own = { ...luxe, key: 'own-draft', label: 'Own draft', sampleSet: 'custom', samples: { categories: [{ label: 'Cakes' }], products: [{ name: 'Red Velvet', price: 9000, category: 'Cakes' }] } }
  const r = await studio(SC.createStudio, founderTok, { body: own })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  await studio(SC.updateStudio, founderTok, { params: { id: r.body._id }, body: own })
  const demo = await Store.findOne({ slug: 'demo-own-draft' })
  assert.ok(demo?.isDemo, 'preview shop made')
  assert.deepEqual((await Product.find({ store: demo._id })).map((p) => p.name), ['Red Velvet'])
  assert.equal((await studio(SC.getStudio, founderTok, { params: { id: r.body._id } })).body.previewSlug, 'demo-own-draft')
  assert.ok(!(await run([PL.getDemos], {}, false)).body.some?.((d) => d.template === 'own-draft'), 'not in the public demos')
  assert.equal((await studio(SC.deleteStudio, founderTok, { params: { id: r.body._id } })).statusCode, 200)
  assert.equal(await Store.findOne({ slug: 'demo-own-draft' }), null)
})

// ---------- keeping the template's products and pictures ----------
const ST = await imp('controllers/storeController.js')
const P = await imp('controllers/productController.js')
const { unmarkSample, samplePicture } = await imp('utils/sampleData.js')
await check('a drawn sample picture can lose its SAMPLE mark; other pictures are untouched', async () => {
  const pic = samplePicture('Silk Dress', '#111111', '#222222')
  assert.ok(decodeURIComponent(pic).includes('>SAMPLE</text>'))
  const clean = unmarkSample(pic)
  assert.ok(!decodeURIComponent(clean).includes('SAMPLE'))
  assert.ok(decodeURIComponent(clean).includes('Silk Dress'), 'the rest of the picture stays')
  assert.ok(decodeURIComponent(clean).endsWith('</svg>'))
  for (const v of ['https://res.cloudinary.com/x/a.jpg', '', null, 'data:image/png;base64,AAAA']) assert.equal(unmarkSample(v), v)
})
await check('publishing does not force removing the samples: "Keep" makes them the shop\'s own', async () => {
  const s = await signup('keeper', 'Keeper Shop', 'classic')
  const host = `${s.shop.slug}.shopsy.ng`
  const as = { host, token: s.account.token }
  const before = (await run([protect, admin, ST.getSetup], as)).body
  const step = before.steps.find((x) => x.id === 'samples')
  assert.equal(step.label, 'Keep or remove the sample products')
  assert.equal(step.done, false)
  const count = await Product.countDocuments({ store: s.shop._id })
  const r = await run([protect, admin, ST.keepSamples], as)
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  assert.equal(r.body.kept.products, count)
  assert.equal(r.body.setup.steps.find((x) => x.id === 'samples').done, true)
  assert.equal(await Product.countDocuments({ store: s.shop._id }), count, 'nothing deleted')
  assert.equal(await Product.countDocuments({ store: s.shop._id, isSample: true }), 0)
  assert.equal(await Category.countDocuments({ store: s.shop._id, isSample: true }), 0)
  for (const p of await Product.find({ store: s.shop._id })) assert.ok(!decodeURIComponent(p.image).includes('>SAMPLE<'), p.name)
  const set = await Settings.findOne({ store: s.shop._id })
  const pictured = set.homeSections.filter((x) => x.data?.image)
  assert.ok(pictured.length >= 2, 'the banner and featured sections have pictures')
  for (const x of pictured) assert.ok(!decodeURIComponent(x.data.image).includes('>SAMPLE<'), x.id)
  const other = await signup('keeper2', 'Other Shop', 'fresh')
  assert.ok((await Product.countDocuments({ store: other.shop._id, isSample: true })) > 0, "another shop's samples are untouched")
})
await check('editing a sample product makes it the merchant\'s own', async () => {
  const s = await signup('editor', 'Edit Shop', 'classic')
  const p = await Product.findOne({ store: s.shop._id, isSample: true })
  const r = await run([protect, admin, P.updateProduct], { host: `${s.shop.slug}.shopsy.ng`, token: s.account.token, params: { id: String(p._id) }, body: { price: 9999 } })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  const after = await Product.findOne({ _id: p._id, store: s.shop._id })
  assert.equal(after.isSample, false)
  assert.equal(after.price, 9999)
  assert.ok(!decodeURIComponent(after.image).includes('>SAMPLE<'))
  assert.ok((await Product.countDocuments({ store: s.shop._id, isSample: true })) > 0, 'the others stay samples')
})
await check("the builder can load another template's homepage, made ready for this shop", async () => {
  const s = await signup('switcher', 'Switch Shop', 'classic')
  const as = { host: `${s.shop.slug}.shopsy.ng`, token: s.account.token }
  const r = await run([protect, admin, S.getTemplateHomepage], { ...as, params: { template: 'fresh' } })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  assert.equal(r.body.hero.heading, 'Hot meals from Switch Shop')
  const menu = r.body.homeSections.find((x) => x.id === 's-menu')
  assert.equal(menu.data.source, 'newest', 'this shop has no "meals" category')
  assert.equal((await Settings.findOne({ store: s.shop._id })).homeSections.some((x) => x.id === 's-menu'), false, 'nothing saved')
  assert.equal((await run([protect, admin, S.getTemplateHomepage], { ...as, params: { template: 'nope' } })).statusCode, 404)
  const priv = await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'vip-only', label: 'VIP', visibility: 'private', allowedEmails: 'someone@else.ng' } })
  await studio(SC.setStudioStatus, founderTok, { params: { id: priv.body._id }, body: { status: 'published' } })
  assert.equal((await run([protect, admin, S.getTemplateHomepage], { ...as, params: { template: 'vip-only' } })).statusCode, 404, 'a private template stays private')
})
await check('a Studio template can bring up to 60 products and 20 categories', async () => {
  const cats = Array.from({ length: 25 }, (_, i) => ({ label: `Cat ${i + 1}` }))
  const prods = Array.from({ length: 70 }, (_, i) => ({ name: `Thing ${i + 1}`, price: 1000 + i, category: `Cat ${(i % 20) + 1}` }))
  const r = await studio(SC.createStudio, founderTok, { body: { ...luxe, key: 'big-range', label: 'Big range', sampleSet: 'custom', samples: { categories: cats, products: prods } } })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body).slice(0, 300))
  assert.equal(r.body.samples.categories.length, 20)
  assert.equal(r.body.samples.products.length, 60)
})

console.log(`${FAKE ? '[in-memory] ' : '[MongoDB] '}${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL', f)
if (!FAKE) {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}
process.exit(failures.length ? 1 : 0)
