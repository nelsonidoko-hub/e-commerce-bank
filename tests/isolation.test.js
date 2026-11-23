// Shop isolation tests: three shops, and every way one could reach another's
// data. Runs the real models, middleware and controllers.
//
//   npm run test:isolation
//
// needs MONGO_URI_TEST in .env, pointing at a THROWAWAY database whose name
// contains "test" (e.g. mongodb://127.0.0.1:27017/shop_platform_test).
// The database is wiped at the start. Never point it at your real data.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
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
  BASIC_PRODUCT_LIMIT: '3',
  TRIAL_DAYS: '7',
  GRACE_DAYS: '7',
  NODE_ENV: 'production',
})
delete process.env.PAYSTACK_SECRET_KEY
delete process.env.DEFAULT_STORE_SLUG

const mg = await import('mongoose')
const mongoose = mg.default
// In the developer's sandbox an in-memory stand-in replaces Mongoose
const FAKE = typeof mg.__reset === 'function'
const ObjectId = mongoose.Types.ObjectId

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
const Order = (await imp('models/Order.js')).default
const Category = (await imp('models/Category.js')).default
const Discount = (await imp('models/Discount.js')).default
const Page = (await imp('models/Page.js')).default
const Settings = (await imp('models/Settings.js')).default
const { resolveStore, storeOpen, forgetStore, findStore } = await imp('middleware/storeMiddleware.js')
const { protect, admin } = await imp('middleware/authMiddleware.js')
const { originAllowed } = await imp('middleware/corsConfig.js')
const P = await imp('controllers/productController.js')
const O = await imp('controllers/orderController.js')
const A = await imp('controllers/authController.js')
const C = await imp('controllers/categoryController.js')
const D = await imp('controllers/discountController.js')
const S = await imp('controllers/settingsController.js')
const PG = await imp('controllers/pageController.js')
const PS = await imp('controllers/paymentSettingsController.js')
const PAY = await imp('controllers/paymentController.js')
const ST = await imp('controllers/storeController.js')
const { TenantGuardError } = await imp('utils/tenant.js')
const { clearPaystackCache } = await imp('utils/paystackConfig.js')
const { storeState } = await imp('utils/storeAccess.js')
const { getPlans, envNumber } = await imp('utils/plans.js')
const { storeUrl } = await imp('utils/storeUrl.js')
const { expireUnpaidOrders } = await imp('utils/expireOrders.js')
const { migrate } = await imp('scripts/migrateToStores.js')

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

// ---------- a tiny Express ----------
function request({ host, slug, token, body = {}, params = {}, query = {}, url = '/api/x' }) {
  const headers = {}
  if (host) headers['x-store-host'] = host
  if (slug) headers['x-store-slug'] = slug
  if (token) headers.authorization = `Bearer ${token}`
  return {
    headers, body, params, query, ip: '1.1.1.1',
    path: url.replace(/^\/api/, ''), originalUrl: url,
    get(h) { return headers[h.toLowerCase()] },
  }
}
function response() {
  const r = { statusCode: 200, body: undefined }
  r.status = (c) => ((r.statusCode = c), r)
  r.json = (b) => ((r.body = JSON.parse(JSON.stringify(b ?? null))), r)
  r.sendStatus = (c) => ((r.statusCode = c), r)
  return r
}
async function run(chain, opts) {
  const req = request(opts)
  const res = response()
  for (const fn of [resolveStore, storeOpen, ...chain]) {
    let nextCalled = false
    await fn(req, res, () => (nextCalled = true))
    if (!nextCalled) break
  }
  return res
}
const as = (who, shopHost) => ({ token: who?.token, host: shopHost })

// ---------- seed: three shops ----------
const DAY = 864e5
const now = Date.now()
const hostA = 'amaka.shopsy.ng'
const hostB = 'bola.shopsy.ng'
const hostC = 'chidi.shopsy.ng'

async function reset() {
  if (FAKE) mg.__reset()
  else {
    await mongoose.connection.dropDatabase()
    for (const m of Object.values(mongoose.models)) await m.syncIndexes()
  }
  forgetStore()
  clearPaystackCache()
}
// Old-style documents with no shop, as the single-store version saved them
async function rawInsert(Model, doc) {
  if (FAKE) Model.__docs.push(doc)
  else await Model.collection.insertOne(doc)
}

async function seed() {
  await reset()
  const mA = await User.create({ store: null, role: 'merchant', name: 'Amaka', email: 'amaka@x.ng', password: 'amaka-pass-1' })
  const mB = await User.create({ store: null, role: 'merchant', name: 'Bola', email: 'bola@x.ng', password: 'bola-pass-1' })
  const mC = await User.create({ store: null, role: 'merchant', name: 'Chidi', email: 'chidi@x.ng', password: 'chidi-pass-1' })
  const sA = await Store.create({ name: 'Amaka Styles', slug: 'amaka', owner: mA._id, notifyEmail: 'amaka@x.ng', plan: 'basic', publishedAt: new Date(now - DAY), trialEndsAt: new Date(now + 6 * DAY) })
  const sB = await Store.create({ name: 'Bola Gadgets', slug: 'bola', owner: mB._id, notifyEmail: 'bola@x.ng', plan: 'pro', publishedAt: new Date(now - 30 * DAY), currentPeriodEnd: new Date(now + 20 * DAY) })
  const sC = await Store.create({ name: 'Chidi Draft', slug: 'chidi', owner: mC._id, notifyEmail: 'chidi@x.ng' })
  const pA = await Product.create({ store: sA._id, name: 'Ankara Dress', price: 10000, category: 'dresses', image: 'a.jpg', sizes: [{ size: 'M', stock: 5 }] })
  const pB = await Product.create({ store: sB._id, name: 'Phone', price: 200000, category: 'phones', image: 'b.jpg', sizes: [{ size: 'One', stock: 5 }], bestSeller: true })
  return { mA, mB, mC, sA, sB, sC, pA, pB }
}
async function login(host, email, password) {
  const r = await run([A.loginUser], { host, body: { email, password }, url: '/api/users/login' })
  return r.body
}

// ======================================================================
let w = await seed()
const adminA = await login(hostA, 'amaka@x.ng', 'amaka-pass-1')
const adminB = await login(hostB, 'bola@x.ng', 'bola-pass-1')

// ---------- 1. finding the shop ----------
await check('subdomain finds the right shop', async () => {
  assert.equal(String((await findStore({ host: hostA }))._id), String(w.sA._id))
  assert.equal(String((await findStore({ host: 'BOLA.Shopsy.ng:443' }))._id), String(w.sB._id))
})
await check('unknown shop, nested subdomain, bare and www domain are not shops', async () => {
  assert.equal(await findStore({ host: 'nobody.shopsy.ng' }), null)
  assert.equal(await findStore({ host: 'a.amaka.shopsy.ng' }), null)
  assert.equal(await findStore({ host: 'shopsy.ng' }), null)
  assert.equal(await findStore({ host: 'www.shopsy.ng' }), null)
  const r = await run([P.getProducts], { host: 'nobody.shopsy.ng' })
  assert.equal(r.statusCode, 404)
  assert.equal(r.body.code, 'STORE_NOT_FOUND')
})
await check('slug header works on localhost/previews but never overrides a real subdomain', async () => {
  assert.equal(String((await findStore({ host: 'localhost', slug: 'bola' }))._id), String(w.sB._id))
  assert.equal(String((await findStore({ host: 'my-app.vercel.app', slug: 'bola' }))._id), String(w.sB._id))
  assert.equal(String((await findStore({ host: hostA, slug: 'bola' }))._id), String(w.sA._id))
})
await check('custom domain only counts once verified', async () => {
  await Store.updateOne({ _id: w.sB._id }, { $set: { customDomain: 'bolagadgets.com', customDomainVerified: false } })
  forgetStore()
  assert.equal(await findStore({ host: 'bolagadgets.com', slug: 'amaka' }), null)
  await Store.updateOne({ _id: w.sB._id }, { $set: { customDomainVerified: true } })
  forgetStore()
  assert.equal(String((await findStore({ host: 'www.bolagadgets.com' }))._id), String(w.sB._id))
  assert.equal(await originAllowed('https://bolagadgets.com'), true)
  assert.equal(await originAllowed('https://evil.com'), false)
})
await check('CORS: platform subdomains yes, http and lookalikes no', async () => {
  assert.equal(await originAllowed('https://amaka.shopsy.ng'), true)
  assert.equal(await originAllowed('http://amaka.shopsy.ng'), false)
  assert.equal(await originAllowed('https://amaka.shopsy.ng.evil.com'), false)
  assert.equal(await originAllowed('https://evilshopsy.ng'), false)
})

// ---------- 2. storefront data ----------
await check('each shop lists only its own products', async () => {
  const a = await run([P.getProducts], { host: hostA })
  const b = await run([P.getProducts], { host: hostB })
  assert.deepEqual(a.body.map((p) => p.name), ['Ankara Dress'])
  assert.deepEqual(b.body.map((p) => p.name), ['Phone'])
})
await check("another shop's product id is 'not found'", async () => {
  const r = await run([P.getProductById], { host: hostA, params: { id: String(w.pB._id) } })
  assert.equal(r.statusCode, 404)
  const bad = await run([P.getProductById], { host: hostA, params: { id: 'not-an-id' } })
  assert.equal(bad.statusCode, 404)
})
await check('search, best sellers and category pages stay in the shop', async () => {
  assert.equal((await run([P.searchProducts], { host: hostA, query: { q: 'phone' } })).body.length, 0)
  assert.equal((await run([P.getBestSellers], { host: hostA })).body.length, 0)
  assert.equal((await run([P.getProductsByCategory], { host: hostA, params: { categoryName: 'phones' } })).body.length, 0)
  assert.equal((await run([P.searchProducts], { host: hostB, query: { q: 'phone' } })).body.length, 1)
})

// ---------- 3. admins ----------
await check("shop A's owner is admin on A, not on B", async () => {
  assert.equal(adminA.role, 'admin')
  const onB = await run([protect, admin, O.getAllOrders], as(adminA, hostB))
  assert.equal(onB.statusCode, 403)
})
await check("A's owner can't edit or delete B's product, even through A", async () => {
  const viaB = await run([protect, admin, P.updateProduct], { ...as(adminA, hostB), params: { id: String(w.pB._id) }, body: { price: 1 } })
  assert.equal(viaB.statusCode, 403)
  const viaA = await run([protect, admin, P.updateProduct], { ...as(adminA, hostA), params: { id: String(w.pB._id) }, body: { price: 1 } })
  assert.equal(viaA.statusCode, 404)
  const del = await run([protect, admin, P.deleteProduct], { ...as(adminA, hostA), params: { id: String(w.pB._id) } })
  assert.equal(del.statusCode, 404)
  assert.equal((await Product.findOne({ store: w.sB._id, _id: w.pB._id })).price, 200000)
})
await check('a request body cannot move a product into another shop', async () => {
  const created = await run([protect, admin, P.createProduct], { ...as(adminA, hostA), body: { store: String(w.sB._id), name: 'Sneaky', price: 1, category: 'x', image: 'x.jpg', sizes: [] } })
  assert.equal(created.statusCode, 201)
  assert.equal(created.body.store, String(w.sA._id))
  const upd = await run([protect, admin, P.updateProduct], { ...as(adminA, hostA), params: { id: String(w.pA._id) }, body: { store: String(w.sB._id), name: 'Renamed' } })
  assert.equal(upd.body.store, String(w.sA._id))
  assert.equal(upd.body.name, 'Renamed')
})
await check('Basic product limit (BASIC_PRODUCT_LIMIT=3), Pro unlimited', async () => {
  // A has 2 products now (seed + "Sneaky")
  const third = await run([protect, admin, P.createProduct], { ...as(adminA, hostA), body: { name: 'Third', price: 1, category: 'x', image: 'x.jpg' } })
  assert.equal(third.statusCode, 201)
  const fourth = await run([protect, admin, P.createProduct], { ...as(adminA, hostA), body: { name: 'Fourth', price: 1, category: 'x', image: 'x.jpg' } })
  assert.equal(fourth.statusCode, 403)
  assert.equal(fourth.body.code, 'PLAN_LIMIT')
  for (let i = 0; i < 4; i++) {
    const r = await run([protect, admin, P.createProduct], { ...as(adminB, hostB), body: { name: `P${i}`, price: 1, category: 'x', image: 'x.jpg' } })
    assert.equal(r.statusCode, 201)
  }
})

// ---------- 4. customers ----------
let custA, custB
await check('the same email can sign up at two shops as two separate accounts', async () => {
  const a = await run([A.registerUser], { host: hostA, body: { name: 'Tolu', email: 'tolu@x.ng', password: 'tolu-pass-A' } })
  const b = await run([A.registerUser], { host: hostB, body: { name: 'Tolu', email: 'tolu@x.ng', password: 'tolu-pass-B' } })
  assert.equal(a.statusCode, 201)
  assert.equal(b.statusCode, 201)
  assert.notEqual(a.body._id, b.body._id)
  assert.equal(a.body.role, 'customer')
  const dup = await run([A.registerUser], { host: hostA, body: { name: 'Tolu', email: 'TOLU@x.ng', password: 'whatever-1' } })
  assert.equal(dup.statusCode, 400)
  custA = a.body
  custB = b.body
})
await check("each shop's password only works on that shop", async () => {
  assert.equal((await run([A.loginUser], { host: hostA, body: { email: 'tolu@x.ng', password: 'tolu-pass-B' } })).statusCode, 401)
  assert.equal((await run([A.loginUser], { host: hostA, body: { email: 'tolu@x.ng', password: 'tolu-pass-A' } })).statusCode, 200)
})
await check("a customer's login from shop A is refused on shop B", async () => {
  const r = await run([protect, O.getMyOrders], as(custA, hostB))
  assert.equal(r.statusCode, 401)
})
await check("a merchant can't sign in on a shop they don't run", async () => {
  const r = await run([A.loginUser], { host: hostB, body: { email: 'amaka@x.ng', password: 'amaka-pass-1' } })
  assert.equal(r.statusCode, 401)
})
await check('a customer is never an admin', async () => {
  const r = await run([protect, admin, O.getAllOrders], as(custA, hostA))
  assert.equal(r.statusCode, 403)
})
await check("customers list shows only this shop's customers", async () => {
  const r = await run([protect, admin, A.getAllCustomers], as(adminA, hostA))
  assert.equal(r.body.length, 1)
  assert.equal(r.body[0]._id, custA._id)
  assert.equal(r.body[0].password, undefined)
})

// ---------- 5. checkout ----------
let orderA
await check("checkout on A refuses B's product and leaves B's stock alone", async () => {
  const r = await run([protect, O.createOrder], { ...as(custA, hostA), body: { items: [{ product: String(w.pB._id), size: 'One', quantity: 1 }], deliveryMethod: 'pickup', shippingAddress: { phone: '0801' } } })
  assert.equal(r.statusCode, 400)
  const pB = await Product.findOne({ store: w.sB._id, _id: w.pB._id })
  assert.equal(pB.sizes[0].stock, 5)
})
await check('checkout on A takes A stock and numbers the order AMA-10001', async () => {
  const r = await run([protect, O.createOrder], { ...as(custA, hostA), body: { items: [{ product: String(w.pA._id), size: 'M', quantity: 2 }], deliveryMethod: 'pickup', shippingAddress: { phone: '0801' } } })
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  assert.equal(r.body.orderNumber, 'AMA-10001')
  assert.equal(r.body.store, String(w.sA._id))
  orderA = r.body
  assert.equal((await Product.findOne({ store: w.sA._id, _id: w.pA._id })).sizes[0].stock, 3)
})
await check("each shop's order numbers start at 10001", async () => {
  const r = await run([protect, O.createOrder], { ...as(custB, hostB), body: { items: [{ product: String(w.pB._id), size: 'One', quantity: 1 }], deliveryMethod: 'pickup', shippingAddress: { phone: '0802' } } })
  assert.equal(r.body.orderNumber, 'BOL-10001')
})
await check("an order can't be read, cancelled or updated from another shop", async () => {
  assert.equal((await run([protect, O.getOrderById], { ...as(adminB, hostB), params: { id: orderA._id } })).statusCode, 404)
  assert.equal((await run([protect, O.cancelMyOrder], { ...as(custB, hostB), params: { id: orderA._id } })).statusCode, 400)
  assert.equal((await run([protect, admin, O.updateOrderStatus], { ...as(adminB, hostB), params: { id: orderA._id }, body: { status: 'cancelled' } })).statusCode, 404)
  const still = await Order.findOne({ store: w.sA._id, _id: orderA._id })
  assert.equal(still.status, 'pending')
})
await check("admin lists show only this shop's orders", async () => {
  const a = await run([protect, admin, O.getAllOrders], as(adminA, hostA))
  const b = await run([protect, admin, O.getAllOrders], as(adminB, hostB))
  assert.deepEqual(a.body.map((o) => o.orderNumber), ['AMA-10001'])
  assert.deepEqual(b.body.map((o) => o.orderNumber), ['BOL-10001'])
  const byUser = await run([protect, admin, O.getOrdersByUserId], { ...as(adminB, hostB), params: { userId: custA._id } })
  assert.equal(byUser.body.length, 0)
})

// ---------- 6. discounts, categories, pages, settings ----------
await check("one shop's discount code doesn't work at another", async () => {
  const c = await run([protect, admin, D.createDiscount], { ...as(adminB, hostB), body: { code: 'SAVE10', discountType: 'percent', value: 10 } })
  assert.equal(c.statusCode, 201)
  const onA = await run([protect, D.validateDiscountCode], { ...as(custA, hostA), body: { code: 'SAVE10', subtotal: 50000 } })
  assert.equal(onA.statusCode, 400)
  const onB = await run([protect, D.validateDiscountCode], { ...as(custB, hostB), body: { code: 'SAVE10', subtotal: 50000 } })
  assert.equal(onB.body.amount, 5000)
  // and A may create its own SAVE10
  assert.equal((await run([protect, admin, D.createDiscount], { ...as(adminA, hostA), body: { code: 'SAVE10', discountType: 'fixed', value: 500 } })).statusCode, 201)
  const list = await run([protect, admin, D.getDiscounts], as(adminA, hostA))
  assert.equal(list.body.length, 1)
  assert.equal(list.body[0].value, 500)
})
await check('the same category name can exist in two shops, not twice in one', async () => {
  assert.equal((await run([protect, admin, C.createCategory], { ...as(adminA, hostA), body: { name: 'Shoes', label: 'Shoes' } })).statusCode, 201)
  assert.equal((await run([protect, admin, C.createCategory], { ...as(adminB, hostB), body: { name: 'Shoes', label: 'Shoes' } })).statusCode, 201)
  assert.equal((await run([protect, admin, C.createCategory], { ...as(adminA, hostA), body: { name: 'shoes', label: 'Again' } })).statusCode, 400)
  assert.equal((await run([C.getFlatCategories], { host: hostA })).body.length, 1)
})
await check('each shop gets its own copy of the starter pages', async () => {
  const a = await run([PG.getPublicPages], { host: hostA })
  const b = await run([PG.getPublicPages], { host: hostB })
  assert.ok(a.body.length > 0)
  assert.equal(a.body.length, b.body.length)
  assert.notEqual(a.body[0]._id, b.body[0]._id)
})
await check('settings are separate and start with the shop name', async () => {
  const a = await run([S.getSettings], { host: hostA })
  assert.equal(a.body.storeName, 'Amaka Styles')
  await run([protect, admin, S.updateSettings], { ...as(adminB, hostB), body: { storeName: 'Bola Mega' } })
  assert.equal((await run([S.getSettings], { host: hostA })).body.storeName, 'Amaka Styles')
  assert.equal((await run([S.getSettings], { host: hostB })).body.storeName, 'Bola Mega')
})

// ---------- 7. payments ----------
const keyA = 'sk_test_' + 'a'.repeat(30)
const keyB = 'sk_test_' + 'b'.repeat(30)
await check('each shop saves its own Paystack key', async () => {
  const a = await run([protect, admin, PS.updatePaymentSettings], { ...as(adminA, hostA), body: { password: 'amaka-pass-1', testSecretKey: keyA, mode: 'test' } })
  const b = await run([protect, admin, PS.updatePaymentSettings], { ...as(adminB, hostB), body: { password: 'bola-pass-1', testSecretKey: keyB, mode: 'test' } })
  assert.equal(a.statusCode, 200, JSON.stringify(a.body))
  assert.equal(b.statusCode, 200)
  assert.equal(a.body.test.last4, 'aaaa')
  assert.equal(b.body.test.last4, 'bbbb')
  assert.match(a.body.webhookPath, new RegExp(`/api/payments/webhook/${w.sA._id}$`))
})
await check("payment uses the shop's own key and returns to the shop's address", async () => {
  globalThis.__axiosCalls = []
  globalThis.__axios = async () => ({ data: { status: true } })
  const r = await run([protect, PAY.initializePayment], { ...as(custA, hostA), body: { orderId: orderA._id } })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  const call = globalThis.__axiosCalls[0]
  assert.equal(call.opts.headers.Authorization, `Bearer ${keyA}`)
  assert.equal(call.body.callback_url, 'https://amaka.shopsy.ng/payment-success')
})
await check("a shop with no key can't take payments (no fallback to anyone else's key)", async () => {
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_' + 'p'.repeat(30)
  const sD = await Store.create({ name: 'Dayo', slug: 'dayo', owner: w.mC._id, publishedAt: new Date(), trialEndsAt: new Date(now + DAY) })
  const cust = (await run([A.registerUser], { host: 'dayo.shopsy.ng', body: { name: 'Kemi', email: 'kemi@x.ng', password: 'kemi-pass-1' } })).body
  const pD = await Product.create({ store: sD._id, name: 'Cake', price: 5000, category: 'cakes', image: 'c.jpg', sizes: [{ size: 'Small', stock: 3 }] })
  const ord = await run([protect, O.createOrder], { ...as(cust, 'dayo.shopsy.ng'), body: { items: [{ product: String(pD._id), size: 'Small', quantity: 1 }], deliveryMethod: 'pickup', shippingAddress: { phone: '0803' } } })
  globalThis.__axiosCalls = []
  const r = await run([protect, PAY.initializePayment], { ...as(cust, 'dayo.shopsy.ng'), body: { orderId: ord.body._id } })
  assert.equal(r.statusCode, 503)
  assert.equal(globalThis.__axiosCalls.length, 0)
  delete process.env.PAYSTACK_SECRET_KEY
})
const sign = (body, key) => crypto.createHmac('sha512', key).update(body).digest('hex')
async function webhook(storeId, payload, key) {
  const raw = Buffer.from(JSON.stringify(payload))
  const req = { params: { storeId: String(storeId) }, headers: { 'x-paystack-signature': sign(raw, key) }, body: payload, rawBody: raw }
  const res = response()
  await PAY.paystackWebhook(req, res)
  return res
}
await check("B's webhook can't mark A's order paid, even with B's valid signature", async () => {
  const event = { event: 'charge.success', data: { reference: 'ref1', amount: orderA.totalPrice * 100, metadata: { orderId: orderA._id } } }
  const r = await webhook(w.sB._id, event, keyB)
  assert.equal(r.statusCode, 200)
  assert.equal((await Order.findOne({ store: w.sA._id, _id: orderA._id })).isPaid, false)
})
await check("A's webhook refuses B's signature, accepts A's own", async () => {
  const event = { event: 'charge.success', data: { reference: 'ref2', amount: orderA.totalPrice * 100, metadata: { orderId: orderA._id } } }
  assert.equal((await webhook(w.sA._id, event, keyB)).statusCode, 401)
  assert.equal((await Order.findOne({ store: w.sA._id, _id: orderA._id })).isPaid, false)
  assert.equal((await webhook(w.sA._id, event, keyA)).statusCode, 200)
  assert.equal((await Order.findOne({ store: w.sA._id, _id: orderA._id })).isPaid, true)
})
await check('webhook for an unknown or malformed shop id is refused', async () => {
  assert.equal((await webhook(new ObjectId(), {}, keyA)).statusCode, 404)
  assert.equal((await webhook('abc', {}, keyA)).statusCode, 404)
})

// ---------- 8. live, draft, paused ----------
await check('a draft shop is hidden from visitors', async () => {
  const r = await run([P.getProducts], { host: hostC })
  assert.equal(r.statusCode, 403)
  assert.equal(r.body.code, 'STORE_OFFLINE')
  assert.equal((await run([A.registerUser], { host: hostC, body: { name: 'X', email: 'x@x.ng', password: 'password-1' } })).statusCode, 403)
})
await check('...but its owner can sign in and preview it', async () => {
  const owner = (await run([A.loginUser], { host: hostC, body: { email: 'chidi@x.ng', password: 'chidi-pass-1' }, url: '/api/users/login' })).body
  assert.equal(owner.role, 'admin')
  assert.equal((await run([P.getProducts], as(owner, hostC))).statusCode, 200)
  const status = await run([ST.getStoreStatus], { ...as(owner, hostC), url: '/api/store/status' })
  // status route uses optional login itself; storeOpen lets it through
  assert.equal(status.statusCode, 200)
  // another merchant can't preview it
  assert.equal((await run([P.getProducts], as(adminA, hostC))).statusCode, 403)
})
await check('shop states: trial, active, grace, paused, suspended', () => {
  const t = new Date('2026-12-01T00:00:00Z')
  const d = (n) => new Date(t.getTime() + n * DAY)
  assert.equal(storeState({ publishedAt: d(-1), trialEndsAt: d(6) }, t).state, 'trial')
  assert.equal(storeState({ publishedAt: d(-9), trialEndsAt: d(-2) }, t).state, 'paused') // trial ended, never paid: no grace
  assert.equal(storeState({ publishedAt: d(-40), currentPeriodEnd: d(5) }, t).state, 'active')
  assert.equal(storeState({ publishedAt: d(-40), currentPeriodEnd: d(-3) }, t).state, 'grace')
  assert.equal(storeState({ publishedAt: d(-40), currentPeriodEnd: d(-8) }, t).state, 'paused')
  assert.equal(storeState({ publishedAt: d(-40), currentPeriodEnd: d(5), suspended: true }, t).state, 'suspended')
  assert.equal(storeState({}, t).state, 'draft')
})
await check('visitors see "offline", never billing details', async () => {
  const r = await run([ST.getStoreStatus], { host: hostC, url: '/api/store/status' })
  assert.equal(r.statusCode, 200)
  assert.equal(r.body.state, 'offline')
  assert.equal(r.body.manage, undefined)
})

// ---------- 9. plans from the environment ----------
await check('prices, trial and grace come from Render env, with safe fallbacks', () => {
  process.env.PLAN_BASIC_PRICE = '7,500'
  process.env.PLAN_PRO_PRICE = '₦15000'
  assert.equal(getPlans().basic.price, 7500)
  assert.equal(getPlans().pro.price, 15000)
  process.env.TRIAL_DAYS = '-4'
  assert.equal(envNumber('TRIAL_DAYS'), 7)
  process.env.TRIAL_DAYS = '14'
  assert.equal(envNumber('TRIAL_DAYS'), 14)
  process.env.GRACE_DAYS = '9999'
  assert.equal(envNumber('GRACE_DAYS'), 7)
  process.env.GRACE_DAYS = '3'
  const t = new Date('2026-12-01T00:00:00Z')
  assert.equal(storeState({ publishedAt: t, currentPeriodEnd: new Date(t.getTime() - 4 * DAY) }, t).state, 'paused')
  for (const k of ['PLAN_BASIC_PRICE', 'PLAN_PRO_PRICE', 'TRIAL_DAYS']) delete process.env[k]
  process.env.GRACE_DAYS = '7'
})
await check("staff only count while the shop is on Pro", async () => {
  const staffer = await User.create({ store: null, role: 'merchant', name: 'Staff', email: 'staff@x.ng', password: 'staff-pass-1' })
  await Store.updateOne({ _id: w.sB._id }, { $set: { staff: [staffer._id] } })
  forgetStore()
  const tok = (await run([A.loginUser], { host: hostB, body: { email: 'staff@x.ng', password: 'staff-pass-1' } })).body
  assert.equal(tok.role, 'admin')
  await Store.updateOne({ _id: w.sB._id }, { $set: { plan: 'basic' } })
  forgetStore()
  assert.equal((await run([protect, admin, O.getAllOrders], as(tok, hostB))).statusCode, 403)
  await Store.updateOne({ _id: w.sB._id }, { $set: { plan: 'pro' } })
  forgetStore()
})

// ---------- 10. the safety net itself ----------
await check('a query without a shop is refused, not run', async () => {
  for (const q of [() => Product.find({}), () => Product.findById(w.pA._id), () => Order.countDocuments({ status: 'paid' }), () => Settings.findOne({}), () => Page.updateMany({}, { published: false }), () => Discount.deleteMany({})]) {
    await assert.rejects(async () => await q(), TenantGuardError)
  }
  await assert.rejects(async () => await Product.find({ store: { $ne: w.sA._id } }), TenantGuardError)
  await assert.rejects(async () => await Product.find({ store: null }), TenantGuardError)
  await assert.rejects(async () => await Order.aggregate([{ $group: { _id: '$store' } }]), TenantGuardError)
  await assert.rejects(async () => await Product.updateOne({ store: w.sA._id }, { $set: { store: w.sB._id } }), TenantGuardError)
  // and nothing was changed
  assert.ok((await Page.find({ store: w.sA._id })).every((p) => p.published))
})
await check('saving shop data without a shop fails', async () => {
  await assert.rejects(Product.create({ name: 'Orphan', price: 1, category: 'x', image: 'x' }))
})
await check('the expiry timer works across shops on purpose, and restores the right stock', async () => {
  const before = (await Product.findOne({ store: w.sB._id, _id: w.pB._id })).sizes[0].stock
  await Order.updateMany({ store: w.sB._id, status: 'pending' }, { $set: { expiresAt: new Date(now - 1000) } })
  await expireUnpaidOrders()
  const after = (await Product.findOne({ store: w.sB._id, _id: w.pB._id })).sizes[0].stock
  assert.equal(after, before + 1)
  assert.equal((await Product.findOne({ store: w.sA._id, _id: w.pA._id })).sizes[0].stock, 3)
})

// ---------- 11. addresses ----------
await check('shop addresses', () => {
  assert.equal(storeUrl({ slug: 'amaka' }, '/orders/1'), 'https://amaka.shopsy.ng/orders/1')
  assert.equal(storeUrl({ slug: 'bola', customDomain: 'bola.com', customDomainVerified: true }), 'https://bola.com/')
  const saved = process.env.PLATFORM_DOMAIN
  delete process.env.PLATFORM_DOMAIN
  process.env.FRONTEND_URL = 'http://localhost:5173'
  assert.equal(storeUrl({ slug: 'amaka' }, '/payment-success'), 'http://localhost:5173/payment-success?store=amaka')
  process.env.PLATFORM_DOMAIN = saved
})
await check('reserved and invalid shop addresses are refused', async () => {
  for (const slug of ['www', 'admin', 'a', 'has space', '-dash', 'dash-', 'a--b']) {
    await assert.rejects(Store.create({ name: 'x', slug, owner: w.mA._id }), undefined, slug)
  }
})

// ---------- 12. moving the old single store in ----------
await check('migration puts existing data into shop #1 and keeps order numbers going', async () => {
  await reset()
  // old-style data: no store anywhere, role admin, global counter
  const Counter = (await imp('models/Counter.js')).default
  const adm = new User({ name: 'Owner', email: 'owner@x.ng', password: 'owner-pass-1', role: 'customer' })
  await adm.save()
  await User.collection.updateMany({ _id: adm._id }, { $set: { role: 'admin', store: null } })
  const cust = await User.create({ name: 'Old Customer', email: 'old@x.ng', password: 'old-pass-1', role: 'customer' })
  // the old customer has no shop yet either
  await User.collection.updateMany({ _id: cust._id }, { $set: { store: null } })
  await rawInsert(Product, { _id: new ObjectId(), name: 'Old Shirt', price: 5000, category: 'shirts', image: 's.jpg', sizes: [{ size: 'L', stock: 2 }], createdAt: new Date() })
  await rawInsert(Order, { _id: new ObjectId(), orderNumber: 'ZR-10023', user: cust._id, items: [], totalPrice: 1, status: 'paid', createdAt: new Date() })
  await Counter.findOneAndUpdate({ _id: 'order' }, { $inc: { seq: 23 } }, { upsert: true })
  const logs = []
  const store = await migrate({ name: 'Abuja Store', slug: 'abujastore', prefix: 'ZR', log: (m) => logs.push(m) })
  const host = 'abujastore.shopsy.ng'
  assert.equal((await run([P.getProducts], { host })).body[0].name, 'Old Shirt')
  const ownerLogin = await run([A.loginUser], { host, body: { email: 'owner@x.ng', password: 'owner-pass-1' } })
  assert.equal(ownerLogin.body.role, 'admin')
  const custLogin = await run([A.loginUser], { host, body: { email: 'old@x.ng', password: 'old-pass-1' } })
  assert.equal(custLogin.statusCode, 200)
  const pid = String((await Product.findOne({ store: store._id }))._id)
  const ord = await run([protect, O.createOrder], { ...as(custLogin.body, host), body: { items: [{ product: pid, size: 'L', quantity: 1 }], deliveryMethod: 'pickup', shippingAddress: { phone: '0804' } } })
  assert.equal(ord.body.orderNumber, 'ZR-10024')
  // running it again changes nothing
  await migrate({ name: 'Abuja Store', slug: 'abujastore', log: () => {} })
  assert.equal((await run([P.getProducts], { host })).body.length, 1)
})

console.log(`${FAKE ? '[in-memory] ' : '[MongoDB] '}${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL', f)
if (!FAKE) {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
}
process.exit(failures.length ? 1 : 0)
