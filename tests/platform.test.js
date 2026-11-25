// Phase 2 tests: sign-up, merchant login, "my shops", the one-time sign-in
// link, the setup checklist, publishing, sample products and template demos.
//
//   npm run test:platform
//
// Same rules as isolation.test.js: needs MONGO_URI_TEST pointing at a
// throwaway database whose name contains "test". It is wiped.
import assert from 'node:assert/strict'
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
  TRIAL_DAYS: '7',
  MAX_SHOPS_PER_MERCHANT: '2',
  NODE_ENV: 'production',
})
delete process.env.DEFAULT_STORE_SLUG

const mg = await import('mongoose')
const mongoose = mg.default
const FAKE = typeof mg.__reset === 'function'
if (!FAKE) {
  const uri = process.env.MONGO_URI_TEST || ''
  const dbName = uri.split('?')[0].split('/').pop() || ''
  if (!uri || !/test/i.test(dbName)) {
    console.error('Set MONGO_URI_TEST to a throwaway database whose name contains "test". It will be wiped.')
    process.exit(1)
  }
  await mongoose.connect(uri)
}

const Store = (await imp('models/Store.js')).default
const User = (await imp('models/User.js')).default
const Product = (await imp('models/Product.js')).default
const Category = (await imp('models/Category.js')).default
const HeroSlide = (await imp('models/HeroSlide.js')).default
const { resolveStore, storeOpen, forgetStore } = await imp('middleware/storeMiddleware.js')
const { protect, admin } = await imp('middleware/authMiddleware.js')
const PL = await imp('controllers/platformController.js')
const A = await imp('controllers/authController.js')
const P = await imp('controllers/productController.js')
const O = await imp('controllers/orderController.js')
const S = await imp('controllers/settingsController.js')
const ST = await imp('controllers/storeController.js')
const PS = await imp('controllers/paymentSettingsController.js')
const { clearPaystackCache } = await imp('utils/paystackConfig.js')
const { seedDemos } = await imp('scripts/seedDemos.js')
const { createStore } = await imp('scripts/createStore.js')
const { slugify } = await imp('utils/createShop.js')
const { SAMPLE_TEMPLATES } = await imp('utils/sampleData.js')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed++
  } catch (e) {
    failures.push(`${name}: ${e.message}`)
  }
}

function request({ host, token, body = {}, params = {}, query = {}, url = '/api/x' }) {
  const headers = {}
  if (host) headers['x-store-host'] = host
  if (token) headers.authorization = `Bearer ${token}`
  return { headers, body, params, query, ip: '1.1.1.1', path: url.replace(/^\/api/, ''), originalUrl: url, get(h) { return headers[h.toLowerCase()] } }
}
function response() {
  const r = { statusCode: 200, body: undefined }
  r.status = (c) => ((r.statusCode = c), r)
  r.json = (b) => ((r.body = JSON.parse(JSON.stringify(b ?? null))), r)
  r.sendStatus = (c) => ((r.statusCode = c), r)
  return r
}
// shop requests go through the shop lookup; platform requests don't
async function run(chain, opts, { shop = true } = {}) {
  const req = request(opts)
  const res = response()
  for (const fn of [...(shop ? [resolveStore, storeOpen] : []), ...chain]) {
    let nextCalled = false
    await fn(req, res, () => (nextCalled = true))
    if (!nextCalled) break
  }
  return res
}
const platform = (chain, opts) => run(chain, opts, { shop: false })
const codeFrom = (url) => new URL(url).searchParams.get('code')

async function reset() {
  if (FAKE) mg.__reset()
  else {
    await mongoose.connection.dropDatabase()
    for (const m of Object.values(mongoose.models)) await m.syncIndexes()
  }
  forgetStore()
  clearPaystackCache()
}
await reset()

// ---------- public ----------
await check('plans come from the server settings', async () => {
  process.env.PLAN_BASIC_PRICE = '6000'
  const r = await platform([PL.getPlans], {})
  assert.equal(r.body.plans.find((p) => p.id === 'basic').price, 6000)
  assert.equal(r.body.trialDays, 7)
  delete process.env.PLAN_BASIC_PRICE
})
await check('shop names become clean addresses', () => {
  assert.equal(slugify("Mama's Kitchen & Grill!"), 'mamas-kitchen-grill')
  assert.equal(slugify('  Café Été  '), 'cafe-ete')
})
await check('address check: free, reserved, invalid', async () => {
  assert.equal((await platform([PL.slugCheck], { query: { slug: 'amaka' } })).body.available, true)
  for (const slug of ['www', 'admin', 'demo-fresh', 'ab', '-x-', 'a--b']) {
    assert.equal((await platform([PL.slugCheck], { query: { slug } })).body.available, false, slug)
  }
  assert.equal((await platform([PL.slugCheck], { query: { name: "Mama's Kitchen" } })).body.slug, 'mamas-kitchen')
})

// ---------- sign-up ----------
let amaka
await check('sign-up makes the account and a draft shop wearing the chosen template, with samples', async () => {
  const r = await platform([PL.signup], { body: { acceptTerms: true, name: 'Amaka', email: 'Amaka@x.ng', password: 'amaka-pass-1', shopName: "Amaka's Kitchen", template: 'fresh' } })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  amaka = r.body
  assert.equal(r.body.shop.slug, 'amakas-kitchen')
  assert.equal(r.body.shop.state, 'draft')
  assert.equal(r.body.shop.url, 'https://amakas-kitchen.shopsy.ng/')
  assert.ok(r.body.account.token)
  const store = await Store.findOne({ slug: 'amakas-kitchen' })
  const settings = await S.getStoreSettings(store)
  assert.equal(settings.theme.template, 'fresh')
  assert.equal(settings.storeName, "Amaka's Kitchen")
  assert.equal(await Product.countDocuments({ store: store._id, isSample: true }), 6)
  assert.ok((await Category.countDocuments({ store: store._id, isSample: true })) >= 2)
  assert.equal(await HeroSlide.countDocuments({ store: store._id, isSample: true }), 1)
  assert.match(settings.homeBanner.image, /^data:image\/svg\+xml/)
})
await check('the same email can’t sign up twice (log in instead)', async () => {
  const r = await platform([PL.signup], { body: { acceptTerms: true, name: 'A', email: 'amaka@x.ng', password: 'another-pass-1', shopName: 'Second' } })
  assert.equal(r.statusCode, 400)
  assert.equal(r.body.code, 'ACCOUNT_EXISTS')
  assert.equal(await Store.countDocuments({ slug: 'second' }), 0)
})
await check('a taken address is refused with a suggestion, and no account is left behind', async () => {
  const before = await User.countDocuments({ store: null })
  const r = await platform([PL.signup], { body: { acceptTerms: true, name: 'B', email: 'b@x.ng', password: 'bola-pass-12', shopName: 'X', slug: 'amakas-kitchen' } })
  assert.equal(r.statusCode, 400)
  assert.equal(r.body.suggestion, 'amakas-kitchen-2')
  assert.equal(await User.countDocuments({ store: null }), before)
})
await check('bad sign-up input is refused', async () => {
  assert.equal((await platform([PL.signup], { body: { acceptTerms: true, name: 'B', email: 'not-an-email', password: 'bola-pass-12', shopName: 'X' } })).statusCode, 400)
  assert.equal((await platform([PL.signup], { body: { acceptTerms: true, name: 'B', email: 'b@x.ng', password: 'short', shopName: 'X' } })).statusCode, 400)
  assert.equal((await platform([PL.signup], { body: { acceptTerms: true, name: 'B', email: 'b@x.ng', password: 'bola-pass-12', shopName: '' } })).statusCode, 400)
  assert.equal((await platform([PL.signup], { body: { acceptTerms: true, name: 'B', email: { $gt: '' }, password: 'bola-pass-12', shopName: 'X' } })).statusCode, 400)
})
await check('an unknown template falls back to Classic', async () => {
  const r = await platform([PL.signup], { body: { acceptTerms: true, name: 'Bola', email: 'bola@x.ng', password: 'bola-pass-12', shopName: 'Bola Gadgets', template: '<script>' } })
  assert.equal(r.statusCode, 201)
  const store = await Store.findOne({ slug: 'bola-gadgets' })
  assert.equal((await S.getStoreSettings(store)).theme.template, 'classic')
})

// ---------- logging in ----------
let bolaAccount
await check('merchants log in on the platform; wrong password refused', async () => {
  assert.equal((await platform([PL.login], { body: { email: 'amaka@x.ng', password: 'wrong-password' } })).statusCode, 401)
  const r = await platform([PL.login], { body: { email: 'BOLA@x.ng', password: 'bola-pass-12' } })
  assert.equal(r.statusCode, 200)
  bolaAccount = r.body
})
await check("a shop's customer can't log in to the platform", async () => {
  const store = await Store.findOne({ slug: 'bola-gadgets' })
  await User.create({ store: store._id, role: 'customer', name: 'Cust', email: 'cust@x.ng', password: 'cust-pass-1' })
  assert.equal((await platform([PL.login], { body: { email: 'cust@x.ng', password: 'cust-pass-1' } })).statusCode, 401)
})
await check('"my shops" lists only your own shops', async () => {
  const r = await platform([PL.platformProtect, PL.getMe], { token: amaka.account.token })
  assert.deepEqual(r.body.shops.map((s) => s.slug), ['amakas-kitchen'])
  assert.equal((await platform([PL.platformProtect, PL.getMe], {})).statusCode, 401)
})
await check('a shop login is not a platform login', async () => {
  const shopLogin = await run([A.loginUser], { host: 'bola-gadgets.shopsy.ng', body: { email: 'cust@x.ng', password: 'cust-pass-1' } })
  assert.equal((await platform([PL.platformProtect, PL.getMe], { token: shopLogin.body.token })).statusCode, 401)
})
await check('merchants can open more shops, up to MAX_SHOPS_PER_MERCHANT', async () => {
  const one = await platform([PL.platformProtect, PL.createAnotherShop], { token: amaka.account.token, body: { shopName: 'Amaka Beauty', template: 'glow' } })
  assert.equal(one.statusCode, 201)
  const two = await platform([PL.platformProtect, PL.createAnotherShop], { token: amaka.account.token, body: { shopName: 'Amaka Three' } })
  assert.equal(two.statusCode, 403)
})

// ---------- one-time sign-in link ----------
const amakaHost = 'amakas-kitchen.shopsy.ng'
let amakaShopLogin
await check('"Manage" gives a one-time link into that shop’s admin', async () => {
  const shop = await Store.findOne({ slug: 'amakas-kitchen' })
  const link = await platform([PL.platformProtect, PL.adminLink], { token: amaka.account.token, params: { id: String(shop._id) } })
  assert.match(link.body.url, /^https:\/\/amakas-kitchen\.shopsy\.ng\/admin\/welcome\?code=/)
  const r = await run([A.exchangeCode], { host: amakaHost, body: { code: codeFrom(link.body.url) }, url: '/api/users/exchange-code' })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  assert.equal(r.body.role, 'admin')
  amakaShopLogin = r.body
})
await check('the link works once only', async () => {
  const shop = await Store.findOne({ slug: 'amakas-kitchen' })
  const link = await platform([PL.platformProtect, PL.adminLink], { token: amaka.account.token, params: { id: String(shop._id) } })
  const code = codeFrom(link.body.url)
  assert.equal((await run([A.exchangeCode], { host: amakaHost, body: { code }, url: '/api/users/exchange-code' })).statusCode, 200)
  assert.equal((await run([A.exchangeCode], { host: amakaHost, body: { code }, url: '/api/users/exchange-code' })).statusCode, 400)
})
await check('a link for one shop is refused on another', async () => {
  const shop = await Store.findOne({ slug: 'amakas-kitchen' })
  const link = await platform([PL.platformProtect, PL.adminLink], { token: amaka.account.token, params: { id: String(shop._id) } })
  const other = await run([A.exchangeCode], { host: 'amaka-beauty.shopsy.ng', body: { code: codeFrom(link.body.url) }, url: '/api/users/exchange-code' })
  assert.equal(other.statusCode, 400)
})
await check('an expired link is refused', async () => {
  const shop = await Store.findOne({ slug: 'amakas-kitchen' })
  const link = await platform([PL.platformProtect, PL.adminLink], { token: amaka.account.token, params: { id: String(shop._id) } })
  await User.updateOne({ store: null, email: 'amaka@x.ng' }, { $set: { loginCodeExpires: new Date(Date.now() - 1000) } })
  assert.equal((await run([A.exchangeCode], { host: amakaHost, body: { code: codeFrom(link.body.url) }, url: '/api/users/exchange-code' })).statusCode, 400)
})
await check("you can't get a link into someone else's shop", async () => {
  const shop = await Store.findOne({ slug: 'amakas-kitchen' })
  const r = await platform([PL.platformProtect, PL.adminLink], { token: bolaAccount.token, params: { id: String(shop._id) } })
  assert.equal(r.statusCode, 404)
  assert.equal((await platform([PL.platformProtect, PL.adminLink], { token: bolaAccount.token, params: { id: 'nope' } })).statusCode, 404)
})

// ---------- draft, checklist, samples, publish ----------
await check('the new shop is private: visitors see offline, the owner can preview', async () => {
  assert.equal((await run([P.getProducts], { host: amakaHost })).statusCode, 403)
  const own = await run([P.getProducts], { host: amakaHost, token: amakaShopLogin.token })
  assert.equal(own.statusCode, 200)
  assert.equal(own.body.length, 6)
})
await check('checklist: publishing needs a real product, no samples, and Paystack', async () => {
  const s = await run([protect, admin, ST.getSetup], { host: amakaHost, token: amakaShopLogin.token })
  assert.equal(s.body.canPublish, false)
  assert.equal(s.body.blockers.length, 3)
  const p = await run([protect, admin, ST.publishStore], { host: amakaHost, token: amakaShopLogin.token })
  assert.equal(p.statusCode, 400)
})
await check("removing samples clears only this shop's samples and keeps categories in use", async () => {
  const beauty = await Store.findOne({ slug: 'amaka-beauty' })
  const beautyBefore = await Product.countDocuments({ store: beauty._id, isSample: true })
  // the merchant's own product in a starter category
  await run([protect, admin, P.createProduct], { host: amakaHost, token: amakaShopLogin.token, body: { name: 'Egusi Soup', price: 4500, category: 'meals', image: 'e.jpg', sizes: [{ size: 'Bowl', stock: 10 }] } })
  const r = await run([protect, admin, ST.removeSamples], { host: amakaHost, token: amakaShopLogin.token })
  assert.equal(r.statusCode, 200)
  assert.equal(r.body.removed.products, 6)
  const shop = await Store.findOne({ slug: 'amakas-kitchen' })
  assert.equal(await Product.countDocuments({ store: shop._id }), 1)
  assert.deepEqual((await Category.find({ store: shop._id })).map((c) => c.name), ['meals'])
  assert.equal(await HeroSlide.countDocuments({ store: shop._id }), 0)
  assert.equal((await S.getStoreSettings(shop)).homeBanner.image, '')
  assert.equal(await Product.countDocuments({ store: beauty._id, isSample: true }), beautyBefore)
})
await check('publish: opens the shop and starts the free trial, once', async () => {
  await run([protect, admin, PS.updatePaymentSettings], { host: amakaHost, token: amakaShopLogin.token, body: { password: 'amaka-pass-1', testSecretKey: 'sk_test_' + 'a'.repeat(30), mode: 'test' } })
  const s = await run([protect, admin, ST.getSetup], { host: amakaHost, token: amakaShopLogin.token })
  assert.equal(s.body.canPublish, true, JSON.stringify(s.body.blockers))
  const p = await run([protect, admin, ST.publishStore], { host: amakaHost, token: amakaShopLogin.token })
  assert.equal(p.statusCode, 200, JSON.stringify(p.body))
  const days = (new Date(p.body.trialEndsAt) - Date.now()) / 864e5
  assert.ok(days > 6.9 && days <= 7, String(days))
  assert.equal((await run([P.getProducts], { host: amakaHost })).statusCode, 200)
  assert.equal((await run([protect, admin, ST.publishStore], { host: amakaHost, token: amakaShopLogin.token })).statusCode, 400)
})
await check("customers and other merchants can't publish or remove samples", async () => {
  const beautyHost = 'amaka-beauty.shopsy.ng'
  assert.equal((await run([protect, admin, ST.removeSamples], { host: beautyHost, token: bolaAccount.token })).statusCode, 403)
  assert.equal((await run([protect, admin, ST.publishStore], { host: beautyHost, token: bolaAccount.token })).statusCode, 403)
})

// ---------- template demos ----------
await check('one live demo shop per template, each with valid sample products', async () => {
  const made = await seedDemos({ email: 'owner@platform.ng', password: 'platform-owner-pass', log: () => {} })
  assert.equal(made.length, SAMPLE_TEMPLATES.length)
  const r = await platform([PL.getDemos], {})
  assert.equal(r.body.length, SAMPLE_TEMPLATES.length)
  assert.equal(r.body.find((d) => d.template === 'tech').url, 'https://demo-tech.shopsy.ng/')
  const demo = await run([P.getProducts], { host: 'demo-catalog.shopsy.ng' })
  assert.equal(demo.statusCode, 200)
  assert.equal(demo.body.length, 10)
})
await check('demos refuse real orders', async () => {
  const store = await Store.findOne({ slug: 'demo-fresh' })
  const cust = await User.create({ store: store._id, role: 'customer', name: 'T', email: 't@x.ng', password: 'tester-pass-1' })
  const login = await run([A.loginUser], { host: 'demo-fresh.shopsy.ng', body: { email: 't@x.ng', password: 'tester-pass-1' } })
  const product = await Product.findOne({ store: store._id })
  const r = await run([protect, O.createOrder], { host: 'demo-fresh.shopsy.ng', token: login.body.token, body: { items: [{ product: String(product._id), size: product.sizes[0].size, quantity: 1 }], deliveryMethod: 'pickup', shippingAddress: { phone: '0801' } } })
  assert.equal(r.statusCode, 400)
  assert.equal(r.body.code, 'DEMO_SHOP')
  assert.ok(cust)
})
await check('demos say so on the storefront, and never appear in "my shops"', async () => {
  const status = await run([ST.getStoreStatus], { host: 'demo-glow.shopsy.ng', url: '/api/store/status' })
  assert.equal(status.body.isDemo, true)
  assert.equal(status.body.demoTemplate, 'glow')
  const owner = await platform([PL.login], { body: { email: 'owner@platform.ng', password: 'platform-owner-pass' } })
  assert.equal((await platform([PL.platformProtect, PL.getMe], { token: owner.body.token })).body.shops.length, 0)
})
await check('running the demo seeder again rebuilds, never duplicates', async () => {
  await seedDemos({ email: 'owner@platform.ng', log: () => {} })
  assert.equal(await Store.countDocuments({ isDemo: true }), SAMPLE_TEMPLATES.length)
  const store = await Store.findOne({ slug: 'demo-catalog' })
  assert.equal(await Product.countDocuments({ store: store._id }), 10)
})

// ---------- databases used by the single-store version ----------
await check('old single-store rules are removed on start, so every shop can save', async () => {
  const { fixOldIndexes } = await imp('utils/fixIndexes.js')
  const Page = (await imp('models/Page.js')).default
  const Logo = (await imp('models/Logo.js')).default
  if (!FAKE) {
    // the rules an old database has: one "faq" page, one "main" logo in total
    await Page.collection.dropIndexes().catch(() => {})
    await Page.collection.deleteMany({})
    await Page.collection.createIndex({ slug: 1 }, { unique: true, name: 'slug_1' })
    await Logo.collection.createIndex({ name: 1 }, { unique: true, name: 'name_1' })
  }
  const dropped = await fixOldIndexes(() => {})
  if (!FAKE) {
    assert.ok(dropped >= 2, `dropped ${dropped}`)
    const names = (await Page.collection.indexes()).map((i) => i.name)
    assert.ok(!names.includes('slug_1'), names.join(','))
  }
  // two shops can now both have their starter pages and a logo
  for (const host of ['amakas-kitchen.shopsy.ng', 'demo-glow.shopsy.ng']) {
    const PG = await imp('controllers/pageController.js')
    const r = await run([PG.getPublicPages], { host })
    assert.equal(r.statusCode, 200, JSON.stringify(r.body))
    assert.ok(r.body.length > 0)
  }
})
await check('a brand-new shop survives many first visits at once', async () => {
  const PG = await imp('controllers/pageController.js')
  const signupRes = await platform([PL.signup], { body: { acceptTerms: true, name: 'Race', email: 'race@x.ng', password: 'race-pass-12', shopName: 'Race Shop', template: 'bold' } })
  const shop = await Store.findOne({ slug: 'race-shop' })
  const Page = (await imp('models/Page.js')).default
  const Settings = (await imp('models/Settings.js')).default
  await Page.deleteMany({ store: shop._id })
  await Settings.deleteMany({ store: shop._id })
  const owner = signupRes.body.account.token
  const results = await Promise.all([
    ...Array.from({ length: 5 }, () => run([PG.getPublicPages], { host: 'race-shop.shopsy.ng', token: owner })),
    ...Array.from({ length: 5 }, () => run([S.getSettings], { host: 'race-shop.shopsy.ng', token: owner })),
  ])
  assert.deepEqual(results.map((r) => r.statusCode), Array(10).fill(200), JSON.stringify(results.map((r) => r.body?.message).filter(Boolean)))
  assert.equal(await Settings.countDocuments({ store: shop._id }), 1)
  const slugs = (await Page.find({ store: shop._id })).map((p) => p.slug)
  assert.equal(new Set(slugs).size, slugs.length, 'no duplicate pages')
})
await check('a "duplicate" refusal from a simultaneous create is retried once', async () => {
  const { upsertSafely } = await imp('utils/tenant.js')
  let calls = 0
  const out = await upsertSafely(async () => {
    calls++
    if (calls === 1) { const e = new Error('E11000'); e.code = 11000; throw e }
    return 'found'
  })
  assert.equal(out, 'found')
  assert.equal(calls, 2)
  await assert.rejects(() => upsertSafely(async () => { throw new Error('other') }), /other/)
})
await check('a shop without a logo gets an empty answer, not an error', async () => {
  const L = await imp('controllers/logoController.js')
  const r = await run([L.getLogo], { host: 'bola-gadgets.shopsy.ng', token: bolaAccount.token })
  assert.equal(r.statusCode, 200)
  assert.equal(r.body, null)
  const save = await run([protect, admin, L.saveLogo], { host: 'bola-gadgets.shopsy.ng', token: bolaAccount.token, body: { imageUrl: 'https://x/logo.png' } })
  assert.equal(save.statusCode, 200, JSON.stringify(save.body))
  assert.equal((await run([L.getLogo], { host: 'bola-gadgets.shopsy.ng', token: bolaAccount.token })).body.imageUrl, 'https://x/logo.png')
  // and visitors can't read a draft shop's logo
  assert.equal((await run([L.getLogo], { host: 'bola-gadgets.shopsy.ng' })).statusCode, 403)
})

// ---------- the create-store script ----------
await check('create-store script makes a published shop with the chosen template', async () => {
  const { store } = await createStore({ name: 'Script Shop', slug: 'script-shop', email: 'script@x.ng', password: 'script-pass-1', template: 'tech', publish: true })
  assert.ok(store.publishedAt)
  assert.equal((await S.getStoreSettings(store)).theme.template, 'tech')
  assert.equal(await Product.countDocuments({ store: store._id, isSample: true }), 6)
})

console.log(`${FAKE ? '[in-memory] ' : '[MongoDB] '}${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL', f)
if (!FAKE) {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}
process.exit(failures.length ? 1 : 0)
