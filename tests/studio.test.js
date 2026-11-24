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
  assert.deepEqual(settings.theme.recipe.layout, recipe.layout)
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
  assert.equal(made.length, 9)
})

console.log(`${FAKE ? '[in-memory] ' : '[MongoDB] '}${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL', f)
if (!FAKE) {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}
process.exit(failures.length ? 1 : 0)
