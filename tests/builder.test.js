// Phase 3 tests: homepage sections, the draft and publish, the owner-only
// preview, and merchants' saved templates.
//
//   npm run test:builder
//
// Same rules as the other suites: MONGO_URI_TEST must be a throwaway database
// whose name contains "test". It is wiped.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (p) => import(pathToFileURL(path.join(root, p)).href)
dotenv.config({ path: path.join(root, '.env') })
Object.assign(process.env, { JWT_SECRET: 'x'.repeat(40), PLATFORM_DOMAIN: 'shopsy.ng', NODE_ENV: 'production', MAX_SHOPS_PER_MERCHANT: '5' })

const mg = await import('mongoose')
const mongoose = mg.default
const FAKE = typeof mg.__reset === 'function'
if (!FAKE) {
  const uri = process.env.MONGO_URI_TEST || ''
  if (!uri || !/test/i.test(uri.split('?')[0].split('/').pop() || '')) {
    console.error('Set MONGO_URI_TEST to a throwaway database whose name contains "test". It will be wiped.')
    process.exit(1)
  }
  await mongoose.connect(uri)
}

const Store = (await imp('models/Store.js')).default
const Settings = (await imp('models/Settings.js')).default
const { resolveStore, storeOpen, forgetStore } = await imp('middleware/storeMiddleware.js')
const { protect, admin, optionalLogin } = await imp('middleware/authMiddleware.js')
const S = await imp('controllers/settingsController.js')
const DS = await imp('controllers/designController.js')
const PL = await imp('controllers/platformController.js')
const A = await imp('controllers/authController.js')
const { cleanSections, sectionsFromLegacy, safeLink, safeImage, MAX_SECTIONS } = await imp('utils/sections.js')

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
if (FAKE) mg.__reset()
else {
  await mongoose.connection.dropDatabase()
  for (const m of Object.values(mongoose.models)) await m.syncIndexes()
}
forgetStore()

// Two merchants, one shop each; Amaka's is live so visitors can see it
const signup = async (name, email, shopName, template) =>
  (await run([PL.signup], { body: { acceptTerms: true, name, email, password: `${name}-pass-123`, shopName, template } }, false)).body
const amaka = await signup('amaka', 'amaka@x.ng', 'Amaka Kitchen', 'fresh')
const bola = await signup('bola', 'bola@x.ng', 'Bola Gadgets', 'tech')
await Store.updateOne({ slug: 'amaka-kitchen' }, { $set: { publishedAt: new Date(), trialEndsAt: new Date(Date.now() + 864e6) } })
forgetStore()
const hostA = 'amaka-kitchen.shopsy.ng'
const hostB = 'bola-gadgets.shopsy.ng'
// signed in to her own shop (the platform login also works for the owner)
const tokA = amaka.account.token
const tokB = bola.account.token

const section = (type, data = {}, extra = {}) => ({ type, data, ...extra })

// ---------- section rules ----------
await check('every section type is accepted with its fields, unknown fields dropped', () => {
  const out = cleanSections([
    section('hero'),
    section('products', { title: 'Hot now', source: 'category', category: 'Meals', count: 99, layout: 'carousel', evil: '<x>' }),
    section('banner', { image: 'https://res.cloudinary.com/x/a.jpg', heading: 'Sale', buttonLink: '/shop' }),
    section('featured', { title: 'Picks', category: 'drinks' }),
    section('text', { heading: 'About us', text: 'We cook.', align: 'left' }),
    section('imageText', { heading: 'Our story', imageSide: 'right', buttonLink: 'https://instagram.com/amaka' }),
    section('testimonials', { title: 'Reviews', items: [{ quote: 'Lovely', name: 'Tolu' }] }),
    section('whatsapp', { heading: 'Order on WhatsApp' }),
  ])
  assert.equal(out.length, 8)
  assert.equal(out[1].data.count, 24)
  assert.equal(out[1].data.category, 'meals')
  assert.equal(out[1].data.evil, undefined)
  assert.ok(out.every((s) => /^[a-z0-9-]{4,30}$/.test(s.id)))
  assert.equal(new Set(out.map((s) => s.id)).size, 8)
})
await check('dangerous links and pictures are refused', () => {
  for (const bad of ['javascript:alert(1)', '//evil.com', 'data:text/html,<script>', 'ftp://x', '/a b']) assert.equal(safeLink(bad), null, bad)
  for (const ok of ['/shop', '/category/shoes', 'https://wa.me/234', '']) assert.notEqual(safeLink(ok), null, ok)
  assert.equal(safeImage('javascript:alert(1)'), null)
  assert.equal(safeImage('data:text/html;base64,AAA'), null)
  assert.throws(() => cleanSections([section('banner', { buttonLink: 'javascript:alert(1)' })]), /https/)
})
await check('limits: unknown type, one slideshow, max sections, text length, testimonials', () => {
  assert.throws(() => cleanSections([section('script')]), /Unknown/)
  assert.throws(() => cleanSections([section('hero'), section('hero')]), /Only one/)
  assert.throws(() => cleanSections(Array.from({ length: MAX_SECTIONS + 1 }, () => section('text'))), /up to/)
  assert.throws(() => cleanSections([section('text', { heading: 'x'.repeat(121) })]), /too long/)
  assert.throws(() => cleanSections([section('testimonials', { items: Array(7).fill({ quote: 'q', name: 'n' }) })]), /6 items/)
  assert.throws(() => cleanSections('nope'))
})
await check("shops from before the builder keep their homepage, in the same order", () => {
  const legacy = sectionsFromLegacy({ homeArrivals: { enabled: true, title: 'New In', count: 4 }, homeBestSellers: { enabled: false }, homeCategoryRow: { enabled: true, category: '' }, homeBanner: { enabled: true, heading: 'Big sale' }, homeFeatured: { enabled: true } })
  assert.deepEqual(legacy.map((s) => s.type), ['hero', 'products', 'products', 'banner', 'products', 'featured'])
  assert.equal(legacy[1].data.title, 'New In')
  assert.equal(legacy[1].data.count, 4)
  assert.equal(legacy[2].enabled, false)
  assert.equal(legacy[4].enabled, false) // no category chosen
  assert.equal(legacy[3].data.heading, 'Big sale')
  assert.doesNotThrow(() => cleanSections(legacy))
})

// ---------- draft and publish ----------
await check('the storefront gets sections, and never the draft field', async () => {
  const r = await run([optionalLogin, S.getSettings], { host: hostA })
  assert.equal(r.statusCode, 200)
  assert.ok(Array.isArray(r.body.homeSections) && r.body.homeSections.length > 0)
  assert.equal(r.body.draft, undefined)
})
const mySections = [section('hero'), section('text', { heading: 'Draft heading' }), section('whatsapp', { heading: 'Chat' })]
await check('saving a draft changes nothing for customers', async () => {
  const save = await run([protect, admin, S.saveDraft], { host: hostA, token: tokA, body: { homeSections: mySections, theme: { brandColor: '#123456' } } })
  assert.equal(save.statusCode, 200, JSON.stringify(save.body))
  assert.equal(save.body.hasDraft, true)
  const pub = await run([optionalLogin, S.getSettings], { host: hostA })
  assert.notEqual(pub.body.homeSections[1]?.data?.heading, 'Draft heading')
  assert.notEqual(pub.body.theme.brandColor, '#123456')
})
await check('only the owner sees the draft, and only when asking for the preview', async () => {
  const own = await run([optionalLogin, S.getSettings], { host: hostA, token: tokA, query: { preview: '1' } })
  assert.equal(own.body.homeSections[1].data.heading, 'Draft heading')
  assert.equal(own.body.theme.brandColor, '#123456')
  assert.equal(own.body.isPreview, true)
  assert.notEqual((await run([optionalLogin, S.getSettings], { host: hostA, token: tokA })).body.homeSections[1]?.data?.heading, 'Draft heading')
  assert.notEqual((await run([optionalLogin, S.getSettings], { host: hostA, query: { preview: '1' } })).body.homeSections[1]?.data?.heading, 'Draft heading')
  // another merchant, or a customer of the shop, gets the live design
  assert.notEqual((await run([optionalLogin, S.getSettings], { host: hostA, token: tokB, query: { preview: '1' } })).body.homeSections[1]?.data?.heading, 'Draft heading')
  const cust = (await run([A.registerUser], { host: hostA, body: { name: 'Tolu', email: 'tolu@x.ng', password: 'tolu-pass-1' } })).body
  assert.notEqual((await run([optionalLogin, S.getSettings], { host: hostA, token: cust.token, query: { preview: '1' } })).body.homeSections[1]?.data?.heading, 'Draft heading')
})
await check("you can't read or change another shop's draft", async () => {
  assert.equal((await run([protect, admin, S.getDraft], { host: hostA, token: tokB })).statusCode, 403)
  assert.equal((await run([protect, admin, S.saveDraft], { host: hostA, token: tokB, body: { homeSections: [] } })).statusCode, 403)
  assert.equal((await run([protect, admin, S.publishDraft], { host: hostA, token: tokB })).statusCode, 403)
})
await check('a bad draft is refused and the old draft kept', async () => {
  const r = await run([protect, admin, S.saveDraft], { host: hostA, token: tokA, body: { homeSections: [section('banner', { buttonLink: 'javascript:x' })] } })
  assert.equal(r.statusCode, 400)
  const bad = await run([protect, admin, S.saveDraft], { host: hostA, token: tokA, body: { theme: { template: 'hacker' } } })
  assert.equal(bad.statusCode, 400)
  const d = await run([protect, admin, S.getDraft], { host: hostA, token: tokA })
  assert.equal(d.body.homeSections[1].data.heading, 'Draft heading')
})
await check('publish: the draft becomes live and is cleared', async () => {
  const p = await run([protect, admin, S.publishDraft], { host: hostA, token: tokA })
  assert.equal(p.statusCode, 200, JSON.stringify(p.body))
  assert.equal(p.body.hasDraft, false)
  const pub = await run([optionalLogin, S.getSettings], { host: hostA })
  assert.deepEqual(pub.body.homeSections.map((s) => s.type), ['hero', 'text', 'whatsapp'])
  assert.equal(pub.body.theme.brandColor, '#123456')
  assert.equal(pub.body.theme.template, 'fresh')
  assert.equal((await run([protect, admin, S.publishDraft], { host: hostA, token: tokA })).statusCode, 400)
})
await check('discard throws the draft away, live stays', async () => {
  await run([protect, admin, S.saveDraft], { host: hostA, token: tokA, body: { homeSections: [section('text', { heading: 'Oops' })] } })
  const d = await run([protect, admin, S.discardDraft], { host: hostA, token: tokA })
  assert.equal(d.body.hasDraft, false)
  assert.deepEqual(d.body.homeSections.map((s) => s.type), ['hero', 'text', 'whatsapp'])
})
await check("one shop's design never touches another's", async () => {
  const b = await run([optionalLogin, S.getSettings], { host: hostB, token: tokB })
  assert.equal(b.body.theme.template, 'tech')
  assert.notEqual(b.body.theme.brandColor, '#123456')
  assert.notDeepEqual(b.body.homeSections.map((s) => s.type), ['hero', 'text', 'whatsapp'])
})

// ---------- saved templates ----------
let designId
await check('saving your own template needs Pro', async () => {
  const r = await run([protect, admin, DS.saveDesign], { host: hostA, token: tokA, body: { name: 'My kitchen look' } })
  assert.equal(r.statusCode, 403)
  assert.equal(r.body.code, 'PLAN_LIMIT')
})
await check('on Pro: save, list, apply into the draft', async () => {
  await Store.updateOne({ slug: 'amaka-kitchen' }, { $set: { plan: 'pro' } })
  forgetStore()
  const r = await run([protect, admin, DS.saveDesign], { host: hostA, token: tokA, body: { name: 'My kitchen look' } })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  designId = r.body._id
  assert.equal(r.body.template, 'fresh')
  assert.equal(r.body.sections, 3)
  assert.equal((await run([protect, admin, DS.saveDesign], { host: hostA, token: tokA, body: { name: 'My kitchen look' } })).statusCode, 400)
  const list = await run([protect, admin, DS.listDesigns], { host: hostA, token: tokA })
  assert.deepEqual(list.body.map((d) => d.name), ['My kitchen look'])
  // change the live design, then apply the saved one
  await run([protect, admin, S.saveDraft], { host: hostA, token: tokA, body: { homeSections: [section('hero')] } })
  await run([protect, admin, S.publishDraft], { host: hostA, token: tokA })
  const ap = await run([protect, admin, DS.applyDesign], { host: hostA, token: tokA, params: { id: designId } })
  assert.equal(ap.statusCode, 200)
  const d = await run([protect, admin, S.getDraft], { host: hostA, token: tokA })
  assert.deepEqual(d.body.homeSections.map((s) => s.type), ['hero', 'text', 'whatsapp'])
  // applying only fills the draft
  assert.deepEqual((await run([optionalLogin, S.getSettings], { host: hostA })).body.homeSections.map((s) => s.type), ['hero'])
})
await check("other merchants can't see, apply or delete your templates", async () => {
  await Store.updateOne({ slug: 'bola-gadgets' }, { $set: { plan: 'pro' } })
  forgetStore()
  assert.deepEqual((await run([protect, admin, DS.listDesigns], { host: hostB, token: tokB })).body, [])
  assert.equal((await run([protect, admin, DS.applyDesign], { host: hostB, token: tokB, params: { id: designId } })).statusCode, 404)
  assert.equal((await run([protect, admin, DS.deleteDesign], { host: hostB, token: tokB, params: { id: designId } })).statusCode, 404)
  assert.equal((await run([protect, admin, DS.listDesigns], { host: hostA, token: tokA })).body.length, 1)
})
await check('start a new shop from your own saved template', async () => {
  const designs = await run([PL.platformProtect, PL.myDesigns], { token: tokA }, false)
  assert.equal(designs.body.canUse, true)
  const r = await run([PL.platformProtect, PL.createAnotherShop], { token: tokA, body: { shopName: 'Amaka Two', designId } }, false)
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  const store = await Store.findOne({ slug: 'amaka-two' })
  const settings = await Settings.findOne({ store: store._id })
  assert.equal(settings.theme.template, 'fresh')
  assert.equal(settings.theme.brandColor, '#123456')
  assert.deepEqual(settings.homeSections.map((s) => s.type), ['hero', 'text', 'whatsapp'])
  // someone else's template id is refused
  const other = await run([PL.platformProtect, PL.createAnotherShop], { token: tokB, body: { shopName: 'Bola Two', designId } }, false)
  assert.equal(other.statusCode, 404)
})
await check('deleting your template', async () => {
  assert.equal((await run([protect, admin, DS.deleteDesign], { host: hostA, token: tokA, params: { id: designId } })).statusCode, 200)
  assert.equal((await run([protect, admin, DS.listDesigns], { host: hostA, token: tokA })).body.length, 0)
})

console.log(`${FAKE ? '[in-memory] ' : '[MongoDB] '}${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL', f)
if (!FAKE) {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}
process.exit(failures.length ? 1 : 0)
