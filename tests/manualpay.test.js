// Bank transfer and pay-on-delivery tests: shop settings, placing orders,
// deadlines and stock, the how-to-pay email, and "Mark as paid".
//
//   npm run test:manualpay
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
const Order = (await imp('models/Order.js')).default
const { resolveStore, storeOpen, forgetStore } = await imp('middleware/storeMiddleware.js')
const { protect, admin } = await imp('middleware/authMiddleware.js')
const PL = await imp('controllers/platformController.js')
const A = await imp('controllers/authController.js')
const O = await imp('controllers/orderController.js')
const PAY = await imp('controllers/paymentController.js')
const S = await imp('controllers/settingsController.js')
const { expireUnpaidOrders } = await imp('utils/expireOrders.js')

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

const DAY = 864e5
const now = Date.now()
const wait = () => new Promise((resolve) => setTimeout(resolve, 20))

if (FAKE) mg.__reset()
else {
  await mongoose.connection.dropDatabase()
  for (const m of Object.values(mongoose.models)) await m.syncIndexes()
}
forgetStore()

const signup = async (name, shopName) =>
  (await run([PL.signup], { body: { acceptTerms: true, name, email: `${name}@x.ng`, password: `${name}-pass-123`, shopName } }, false)).body
const bola = await signup('bola', 'Bola Shop')
const tolu = await signup('tolu', 'Tolu Shop')
for (const slug of ['bola-shop', 'tolu-shop']) await Store.updateOne({ slug }, { $set: { publishedAt: new Date(now - DAY), trialEndsAt: new Date(now + 5 * DAY) } })
forgetStore()
const shop = await Store.findOne({ slug: 'bola-shop' })
const host = 'bola-shop.shopsy.ng'
const product = await Product.create({ store: shop._id, name: 'Ankara Gown', price: 10000, category: 'misc', image: 'https://img/a.jpg', sizes: [{ size: 'M', stock: 5 }] })
const cust = (await run([A.registerUser], { host, body: { name: 'Kemi', email: 'kemi@x.ng', password: 'kemi-pass-123' } })).body
const settings = (body) => run([protect, admin, S.updateSettings], { host, token: bola.account.token, body })
const order = (paymentMethod, quantity = 1) =>
  run([protect, O.createOrder], { host, token: cust.token, body: { items: [{ product: String(product._id), size: 'M', quantity }], deliveryMethod: 'pickup', shippingAddress: { phone: '0801' }, paymentMethod } })
const stock = async () => (await Product.findOne({ store: shop._id, _id: product._id })).sizes[0].stock

await check('bank transfer needs a bank, a 10-digit account number and a name before it can be switched on', async () => {
  assert.equal((await settings({ bankTransfer: { enabled: true } })).statusCode, 400)
  assert.equal((await settings({ bankTransfer: { accountNumber: '12345' } })).statusCode, 400)
  assert.equal((await settings({ bankTransfer: { holdHours: 100 } })).statusCode, 400)
  const r = await settings({ bankTransfer: { enabled: true, bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Bola Adeyemi', note: 'Send proof on WhatsApp', holdHours: 12 }, payOnDelivery: { enabled: true } })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
})
await check('the storefront sees the options and that Paystack is not set up', async () => {
  const s = (await run([S.getSettings], { host })).body
  assert.equal(s.bankTransfer.enabled, true)
  assert.equal(s.bankTransfer.accountNumber, '0123456789')
  assert.equal(s.payOnDelivery.enabled, true)
  assert.equal(s.paystackReady, false)
})
let transferId
await check('a transfer order: held for the shop\'s hours, stock reserved, how-to-pay email, merchant told', async () => {
  emails.length = 0
  const r = await order('transfer')
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  transferId = r.body._id
  assert.equal(r.body.paymentMethod, 'transfer')
  const hours = (new Date(r.body.expiresAt) - Date.now()) / 3600e3
  assert.ok(hours > 11.9 && hours <= 12, `held ${hours}h`)
  assert.equal(await stock(), 4)
  await wait()
  const mail = emails.find((e) => e.to === 'kemi@x.ng')
  assert.match(mail.subject, /how to pay/)
  assert.match(mail.html, /0123456789/)
  assert.match(mail.html, /GTBank/)
  assert.match(mail.html, /Send proof on WhatsApp/)
  assert.match(mail.html, new RegExp(r.body.orderNumber || ''))
  assert.ok(emails.some((e) => e.to !== 'kemi@x.ng'), 'the merchant is told about the new order')
})
await check("a transfer order can't be paid online", async () => {
  const r = await run([protect, PAY.initializePayment], { host, token: cust.token, body: { orderId: transferId } })
  assert.equal(r.statusCode, 400)
})
await check('only the shop admin can mark it paid; then it is paid and the customer is emailed', async () => {
  assert.equal((await run([protect, admin, O.markManualPaid], { host, token: cust.token, params: { id: transferId } })).statusCode, 403)
  assert.equal((await run([protect, admin, O.markManualPaid], { host, token: tolu.account.token, params: { id: transferId } })).statusCode, 403)
  emails.length = 0
  const r = await run([protect, admin, O.markManualPaid], { host, token: bola.account.token, params: { id: transferId } })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  assert.equal(r.body.isPaid, true)
  assert.equal(r.body.status, 'paid')
  assert.match(r.body.paymentReference, /^transfer-/)
  await wait()
  assert.ok(emails.some((e) => e.to === 'kemi@x.ng' && /confirmed/.test(e.subject)))
  assert.ok(!emails.some((e) => e.to !== 'kemi@x.ng'), 'no second "new order" email to the merchant')
  assert.equal((await run([protect, admin, O.markManualPaid], { host, token: bola.account.token, params: { id: transferId } })).statusCode, 400)
})
await check('an unpaid transfer order is cancelled after its deadline and the stock comes back', async () => {
  const r = await order('transfer')
  assert.equal(await stock(), 3)
  await Order.updateOne({ store: shop._id, _id: r.body._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
  await expireUnpaidOrders()
  assert.equal((await Order.findOne({ store: shop._id, _id: r.body._id })).status, 'cancelled')
  assert.equal(await stock(), 4)
  // paid late: marking it paid reopens it if the stock is still there
  const late = await run([protect, admin, O.markManualPaid], { host, token: bola.account.token, params: { id: r.body._id } })
  assert.equal(late.body.status, 'paid')
  assert.equal(await stock(), 3)
})
let podId
await check('pay on delivery: no deadline, never auto-cancelled, can be sent out before it is paid', async () => {
  const r = await order('delivery')
  assert.equal(r.statusCode, 201, JSON.stringify(r.body))
  podId = r.body._id
  assert.equal(r.body.expiresAt, undefined)
  await Order.updateOne({ store: shop._id, _id: podId }, { $set: { createdAt: new Date(Date.now() - 5 * DAY) } })
  await expireUnpaidOrders()
  assert.equal((await Order.findOne({ store: shop._id, _id: podId })).status, 'pending')
  const shipped = await run([protect, admin, O.updateOrderStatus], { host, token: bola.account.token, params: { id: podId }, body: { status: 'shipped' } })
  assert.equal(shipped.statusCode, 200, JSON.stringify(shipped.body))
  const paid = await run([protect, admin, O.markManualPaid], { host, token: bola.account.token, params: { id: podId } })
  assert.equal(paid.body.isPaid, true)
})
await check('Paystack orders still need payment before shipping, and are never marked paid by hand', async () => {
  const r = await order(undefined)
  assert.equal(r.body.paymentMethod, 'paystack')
  assert.equal((await run([protect, admin, O.updateOrderStatus], { host, token: bola.account.token, params: { id: r.body._id }, body: { status: 'shipped' } })).statusCode, 400)
  assert.equal((await run([protect, admin, O.markManualPaid], { host, token: bola.account.token, params: { id: r.body._id } })).statusCode, 400)
})
await check('options the shop has switched off are refused', async () => {
  await settings({ payOnDelivery: { enabled: false }, bankTransfer: { enabled: false } })
  assert.equal((await order('delivery')).statusCode, 400)
  assert.equal((await order('transfer')).statusCode, 400)
})

await check('"Mark as paid" is wired for shop admins only', async () => {
  const fs = await import('node:fs')
  const src = fs.readFileSync(path.join(root, 'routes/orderRoutes.js'), 'utf8')
  assert.match(src, /router\.put\('\/:id\/mark-paid', protect, admin, markManualPaid\)/)
})

console.log(`${FAKE ? '[in-memory] ' : '[MongoDB] '}${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL', f)
if (!FAKE) {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}
process.exit(failures.length ? 1 : 0)
