// Market Square tests: who is listed, search and filters, clicks, reports,
// the founder's controls, and that nothing private leaks between shops.
//
//   npm run test:market
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
const Product = (await imp('models/Product.js')).default
const MarketReport = (await imp('models/MarketReport.js')).default
const { resolveStore, storeOpen, forgetStore } = await imp('middleware/storeMiddleware.js')
const { protect, admin } = await imp('middleware/authMiddleware.js')
const PL = await imp('controllers/platformController.js')
const F = await imp('controllers/founderController.js')
const M = await imp('controllers/marketController.js')
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

const market = (fn, opts = {}) => run([fn], opts, false)
const settings = (fn, host, token, body) => run([protect, admin, fn], { host, token, body })
const founder = (fn, opts) => run([PL.platformProtect, F.superadminOnly, fn], opts, false)
const DAY = 864e5
const now = Date.now()

if (FAKE) mg.__reset()
else {
  await mongoose.connection.dropDatabase()
  for (const m of Object.values(mongoose.models)) await m.syncIndexes()
}
forgetStore()

await seedDemos({ email: 'founder@shopsy.ng', password: 'founder-pass-1234', log: () => {} })
const founderTok = (await run([PL.login], { body: { email: 'founder@shopsy.ng', password: 'founder-pass-1234' } }, false)).body.token
const signup = async (name, shopName) =>
  (await run([PL.signup], { body: { acceptTerms: true, name, email: `${name}@x.ng`, password: `${name}-pass-123`, shopName } }, false)).body
const amaka = await signup('amaka', 'Amaka Shoes')
const bola = await signup('bola', 'Bola Gadgets')
const chidi = await signup('chidi', 'Chidi Draft')
const set = async (slug, values) => { await Store.updateOne({ slug }, { $set: values }); forgetStore() }
await set('amaka-shoes', { publishedAt: new Date(now - 5 * DAY), trialEndsAt: new Date(now + 2 * DAY) })
await set('bola-gadgets', { publishedAt: new Date(now - 40 * DAY), plan: 'pro', currentPeriodEnd: new Date(now + 20 * DAY) })
const A = await Store.findOne({ slug: 'amaka-shoes' })
const B = await Store.findOne({ slug: 'bola-gadgets' })
const C = await Store.findOne({ slug: 'chidi-draft' })
const hostA = 'amaka-shoes.shopsy.ng'
const hostB = 'bola-gadgets.shopsy.ng'
const hostC = 'chidi-draft.shopsy.ng'

const add = (store, name, price, extra = {}) =>
  Product.create({ store: store._id, name, price, category: 'misc', image: `https://img.test/${encodeURIComponent(name)}.jpg`, sizes: [{ size: 'M', stock: 3 }], ...extra })
const sneakers = await add(A, 'White Sneakers', 15000, { onSale: true, oldPrice: 20000 })
await add(A, 'Leather Bag', 25000, { sizes: [{ size: 'One', stock: 0 }] })
await add(A, 'Free Sticker', 0)
const phones = []
for (let i = 1; i <= 30; i++) phones.push(await add(B, `Phone ${String(i).padStart(2, '0')}`, 50000 + i * 1000, { category: 'phones' }))
await add(C, 'Draft Shoe', 9000)

await check('nothing is listed until a merchant opts in', async () => {
  const r = await market(M.marketProducts)
  assert.equal(r.body.total, 0)
  assert.equal((await market(M.marketMeta)).body.shops, 0)
})
await check('opting in needs a category; the city is tidied', async () => {
  assert.equal((await settings(M.saveMarketSettings, hostA, amaka.account.token, { listed: true })).statusCode, 400)
  assert.equal((await settings(M.saveMarketSettings, hostA, amaka.account.token, { listed: true, category: 'cars' })).statusCode, 400)
  const r = await settings(M.saveMarketSettings, hostA, amaka.account.token, { listed: true, category: 'shoes-bags', city: '  abuja ' })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  assert.equal(r.body.shown, true)
  assert.equal(r.body.city, 'Abuja')
  assert.equal(r.body.productsShown, 2, 'samples and ₦0 items are left out')
  await settings(M.saveMarketSettings, hostB, bola.account.token, { listed: true, category: 'electronics', city: 'LAGOS' })
})
await check('market lists real products only, with public details and links into the shop', async () => {
  const r = (await market(M.marketProducts, { query: { category: 'shoes-bags' } })).body
  assert.deepEqual(r.products.map((p) => p.name).sort(), ['Leather Bag', 'White Sneakers'])
  const s = r.products.find((p) => p.name === 'White Sneakers')
  assert.deepEqual(Object.keys(s).sort(), ['_id', 'image', 'name', 'oldPrice', 'price', 'shop', 'soldOut', 'url'])
  assert.deepEqual(Object.keys(s.shop).sort(), ['_id', 'city', 'name', 'url'])
  assert.equal(s.url, `https://amaka-shoes.shopsy.ng/product/${sneakers._id}`)
  assert.equal(s.oldPrice, 20000)
  assert.equal(s.shop.name, 'Amaka Shoes')
  assert.equal(r.products.find((p) => p.name === 'Leather Bag').soldOut, true)
})
await check('search, filters, sorting and pages', async () => {
  assert.deepEqual((await market(M.marketProducts, { query: { q: 'SNEAK' } })).body.products.map((p) => p.name), ['White Sneakers'])
  assert.equal((await market(M.marketProducts, { query: { q: '.*' } })).body.total, 0, 'search text is not a pattern')
  assert.equal((await market(M.marketProducts, { query: { q: 'phones' } })).body.total, 30, 'matches product category too')
  assert.equal((await market(M.marketProducts, { query: { city: 'lagos' } })).body.total, 30)
  assert.equal((await market(M.marketProducts, { query: { category: 'electronics', min: '70000', max: '75000' } })).body.total, 6)
  const cheap = (await market(M.marketProducts, { query: { sort: 'price-asc' } })).body
  assert.equal(cheap.total, 32)
  assert.equal(cheap.pages, 2)
  assert.equal(cheap.products[0].name, 'White Sneakers')
  const p2 = (await market(M.marketProducts, { query: { sort: 'price-desc', page: '2' } })).body
  assert.equal(p2.products.length, 8)
  const meta = (await market(M.marketMeta)).body
  assert.equal(meta.shops, 2)
  assert.deepEqual(meta.cities.map((c) => c.name).sort(), ['Abuja', 'Lagos'])
  assert.equal(meta.categories.find((c) => c.id === 'electronics').shops, 1)
})
await check('draft, paused, suspended and demo shops never show, even if switched on', async () => {
  await set('chidi-draft', { 'market.listed': true, 'market.category': 'shoes-bags' })
  await set('demo-fresh', { 'market.listed': true, 'market.category': 'food' })
  assert.ok(!(await market(M.marketProducts, { query: { q: 'draft shoe' } })).body.total)
  assert.equal((await settings(M.getMarketSettings, hostC, chidi.account.token)).body.reason, 'Publish your shop first.')
  await set('amaka-shoes', { trialEndsAt: new Date(now - DAY) })
  assert.equal((await market(M.marketProducts, { query: { category: 'shoes-bags' } })).body.total, 0, 'trial ended = paused')
  await set('amaka-shoes', { trialEndsAt: new Date(now + 2 * DAY), suspended: true })
  assert.equal((await market(M.marketProducts, { query: { category: 'shoes-bags' } })).body.total, 0)
  await set('amaka-shoes', { suspended: false })
  assert.equal((await market(M.marketProducts, { query: { category: 'shoes-bags' } })).body.total, 2)
  assert.equal((await market(M.marketMeta)).body.shops, 2)
})
await check('MARKET_PLANS=pro keeps Basic shops out and tells the merchant why', async () => {
  process.env.MARKET_PLANS = 'pro'
  try {
    assert.equal((await market(M.marketProducts, { query: { category: 'shoes-bags' } })).body.total, 0)
    const s = (await settings(M.getMarketSettings, hostA, amaka.account.token)).body
    assert.equal(s.needsPro, true)
    assert.equal((await market(M.marketProducts)).body.total, 30)
  } finally {
    delete process.env.MARKET_PLANS
  }
})
await check('switching off removes the shop at once', async () => {
  await settings(M.saveMarketSettings, hostA, amaka.account.token, { listed: false })
  assert.equal((await market(M.marketProducts, { query: { category: 'shoes-bags' } })).body.total, 0)
  await settings(M.saveMarketSettings, hostA, amaka.account.token, { listed: true })
})
await check('clicks are counted for the merchant (30 days); unlisted and sample products are refused', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await market(M.marketClick, { body: { productId: String(sneakers._id) } })).statusCode, 200)
  assert.equal((await settings(M.getMarketSettings, hostA, amaka.account.token)).body.visits30, 3)
  assert.equal((await settings(M.getMarketSettings, hostB, bola.account.token)).body.visits30, 0)
  const draftShoe = await Product.findOne({ store: C._id })
  assert.equal((await market(M.marketClick, { body: { productId: String(draftShoe._id) } })).statusCode, 404)
  const sample = await Product.findOne({ store: A._id, isSample: true })
  assert.equal((await market(M.marketClick, { body: { productId: String(sample._id) } })).statusCode, 404)
  assert.equal((await market(M.marketClick, { body: { productId: { $ne: null } } })).statusCode, 404)
})
await check('only the shop admin can change its market settings', async () => {
  assert.equal((await settings(M.saveMarketSettings, hostA, bola.account.token, { listed: false })).statusCode, 403)
  assert.equal((await settings(M.saveMarketSettings, hostA, undefined, { listed: false })).statusCode, 401)
  assert.equal((await settings(M.getMarketSettings, hostA, amaka.account.token)).body.listed, true)
})
await check('shoppers can report a listing; the founder sees it', async () => {
  assert.equal((await market(M.marketReport, { body: { productId: String(phones[0]._id), reason: 'nonsense' } })).statusCode, 400)
  const r = await market(M.marketReport, { body: { productId: String(phones[0]._id), reason: 'fake', details: 'Not original' } })
  assert.equal(r.statusCode, 201)
  const o = (await founder(F.overview, { token: founderTok })).body
  assert.equal(o.market.shops, 2)
  assert.equal(o.market.openReports[0].storeName, 'Bola Gadgets')
  assert.equal(o.market.openReports[0].productName, 'Phone 01')
  const d = (await founder(F.getShop, { token: founderTok, params: { id: String(B._id) } })).body
  assert.equal(d.market.reports[0].details, 'Not original')
  await founder(F.shopAction, { token: founderTok, params: { id: String(B._id) }, body: { action: 'close-reports' } })
  assert.equal((await founder(F.overview, { token: founderTok })).body.market.openReports.length, 0)
  assert.equal(await MarketReport.countDocuments({ status: 'closed' }), 1)
})
await check('founder can hide a shop from the market (reason required); the merchant sees why', async () => {
  assert.equal((await founder(F.shopAction, { token: founderTok, params: { id: String(B._id) }, body: { action: 'market-hide' } })).statusCode, 400)
  const r = await founder(F.shopAction, { token: founderTok, params: { id: String(B._id) }, body: { action: 'market-hide', reason: 'Fake phones reported' } })
  assert.equal(r.body.market.hidden, true)
  assert.equal(r.body.market.shown, false)
  assert.equal((await market(M.marketProducts, { query: { category: 'electronics' } })).body.total, 0)
  assert.equal((await settings(M.getMarketSettings, hostB, bola.account.token)).body.reason, 'Hidden by the platform: Fake phones reported')
  // the merchant can't undo it by switching on again
  await settings(M.saveMarketSettings, hostB, bola.account.token, { listed: true, category: 'electronics' })
  assert.equal((await market(M.marketProducts, { query: { category: 'electronics' } })).body.total, 0)
  await founder(F.shopAction, { token: founderTok, params: { id: String(B._id) }, body: { action: 'market-unhide' } })
  assert.equal((await market(M.marketProducts, { query: { category: 'electronics' } })).body.total, 30)
})
await check('rules hold on their own too (not only through the database query)', async () => {
  const { marketStatus } = await imp('utils/market.js')
  const live = { plan: 'basic', publishedAt: new Date(), trialEndsAt: new Date(now + DAY), market: { listed: true, category: 'food' } }
  assert.equal(marketStatus(live).shown, true)
  assert.equal(marketStatus({ ...live, isDemo: true }).shown, false)
  assert.equal(marketStatus({ ...live, market: { ...live.market, listed: false } }).reason, 'Switched off.')
  assert.equal(marketStatus({ ...live, market: { ...live.market, category: 'cars' } }).shown, false)
})
await check('the settings routes require a shop admin', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(path.join(root, 'routes/marketRoutes.js'), 'utf8')
  for (const method of ['get', 'put']) {
    assert.match(src, new RegExp(`marketSettingsRouter\\.${method}\\('/', protect, admin, `), method)
  }
})
await check('the shop itself still works normally (market is separate)', async () => {
  const P = await imp('controllers/productController.js')
  assert.equal((await run([P.getProducts], { host: hostA })).statusCode, 200)
})

console.log(`${FAKE ? '[in-memory] ' : '[MongoDB] '}${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL', f)
if (!FAKE) {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}
process.exit(failures.length ? 1 : 0)
