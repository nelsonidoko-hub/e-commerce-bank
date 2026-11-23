// Phase 4 tests: merchants paying the platform. Uses a fake Paystack, never
// the real one, and never charges anything.
//
//   npm run test:billing
//
// Same rules as the other suites: MONGO_URI_TEST must be a throwaway database
// whose name contains "test". It is wiped.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import dotenv from 'dotenv'

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const imp = (p) => import(pathToFileURL(path.join(root, p)).href)
dotenv.config({ path: path.join(root, '.env') })

const PLATFORM_KEY = 'sk_test_platform' + 'p'.repeat(24)
Object.assign(process.env, {
  JWT_SECRET: 'x'.repeat(40),
  SETTINGS_ENCRYPTION_KEY: 'k'.repeat(40),
  PLATFORM_DOMAIN: 'shopsy.ng',
  NODE_ENV: 'production',
  PLAN_BASIC_PRICE: '5000',
  PLAN_PRO_PRICE: '12000',
  TRIAL_DAYS: '7',
  GRACE_DAYS: '7',
  RESEND_API_KEY: 'test',
  PLATFORM_NAME: 'Shopsy',
})
delete process.env.PLATFORM_PAYSTACK_SECRET_KEY

// ---------- a fake Paystack ----------
const paystack = {
  calls: [],
  txs: new Map(), // reference -> transaction Paystack would report
  chargeResult: 'success', // what charge_authorization does next
  amountOverride: null, // pretend the customer paid a different amount
}
function fakePaystack(method, url, body, auth) {
  paystack.calls.push({ method, url, body, auth })
  const card = { authorization_code: 'AUTH_secret_code', reusable: true, last4: '4081', card_type: 'visa' }
  if (url.endsWith('/transaction/initialize')) {
    paystack.txs.set(body.reference, { reference: body.reference, status: 'success', amount: paystack.amountOverride ?? body.amount, currency: 'NGN', authorization: card, customer: { email: body.email }, metadata: body.metadata })
    return { status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, reference: body.reference } }
  }
  if (url.includes('/transaction/verify/')) {
    const ref = decodeURIComponent(url.split('/').pop())
    return { status: true, data: paystack.txs.get(ref) || { status: 'failed' } }
  }
  if (url.endsWith('/transaction/charge_authorization')) {
    const ok = paystack.chargeResult === 'success' && body.authorization_code === 'AUTH_secret_code'
    return { status: true, data: { reference: body.reference, status: ok ? 'success' : 'failed', amount: body.amount, currency: 'NGN', gateway_response: ok ? 'Approved' : 'Insufficient Funds', authorization: card, metadata: body.metadata } }
  }
  return { status: false }
}

const mg = await import('mongoose')
const mongoose = mg.default
const FAKE = typeof mg.__reset === 'function'
let server
if (FAKE) {
  globalThis.__axios = async (method, url, body, opts) => ({ data: fakePaystack(method, url, body, opts?.headers?.Authorization) })
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
      const out = fakePaystack(req.method.toLowerCase(), req.url, raw ? JSON.parse(raw) : undefined, req.headers.authorization)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(out))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  process.env.PAYSTACK_API_URL = `http://127.0.0.1:${server.address().port}`
}
const emails = []
globalThis.fetch = async (url, opts) => (emails.push(JSON.parse(opts.body)), { ok: true, text: async () => '' })

const Store = (await imp('models/Store.js')).default
const BillingPayment = (await imp('models/BillingPayment.js')).default
const Product = (await imp('models/Product.js')).default
const { resolveStore, storeOpen, forgetStore } = await imp('middleware/storeMiddleware.js')
const { protect, admin } = await imp('middleware/authMiddleware.js')
const B = await imp('controllers/billingController.js')
const PL = await imp('controllers/platformController.js')
const P = await imp('controllers/productController.js')
const billing = await imp('utils/billing.js')
const { storeState } = await imp('utils/storeAccess.js')

let passed = 0
const failures = []
const check = async (n, f) => { try { await f(); passed++ } catch (e) { failures.push(`${n}: ${e.message}`) } }
function request({ host, token, body = {}, params = {}, query = {}, url = '/api/billing' }) {
  const headers = {}
  if (host) headers['x-store-host'] = host
  if (token) headers.authorization = `Bearer ${token}`
  return { headers, body, params, query, ip: '1.1.1.1', path: url.replace(/^\/api/, ''), originalUrl: url, get(h) { return headers[h.toLowerCase()] } }
}
function response() {
  const r = { statusCode: 200 }
  r.status = (c) => ((r.statusCode = c), r)
  r.json = (b) => ((r.body = JSON.parse(JSON.stringify(b ?? null))), r)
  r.sendStatus = (c) => ((r.statusCode = c), r)
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
const billingCall = (fn, opts) => run([protect, admin, fn], opts)
const DAY = 864e5
const reload = async (slug) => Store.findOne({ slug })
async function setStore(slug, values) {
  await Store.updateOne({ slug }, { $set: values })
  forgetStore()
}

if (FAKE) mg.__reset()
else {
  await mongoose.connection.dropDatabase()
  for (const m of Object.values(mongoose.models)) await m.syncIndexes()
}
forgetStore()

const signup = async (name, shopName) =>
  (await run([PL.signup], { body: { acceptTerms: true, name, email: `${name}@x.ng`, password: `${name}-pass-123`, shopName } }, false)).body
const amaka = await signup('amaka', 'Amaka Kitchen')
const bola = await signup('bola', 'Bola Gadgets')
const hostA = 'amaka-kitchen.shopsy.ng'
const hostB = 'bola-gadgets.shopsy.ng'
const tokA = amaka.account.token
const tokB = bola.account.token
const now = Date.now()
// Amaka published 2 days ago: 5 days of trial left
await setStore('amaka-kitchen', { publishedAt: new Date(now - 2 * DAY), trialEndsAt: new Date(now + 5 * DAY) })

// ---------- switched off until the platform key is set ----------
await check('without the platform key, billing is off and nothing is charged', async () => {
  const r = await billingCall(B.checkout, { host: hostA, token: tokA, body: { plan: 'basic' } })
  assert.equal(r.statusCode, 400)
  assert.match(r.body.message, /not set up/)
  assert.deepEqual(await billing.runBillingCycle(), { renewed: 0, failed: 0, reminders: 0 })
  assert.equal(paystack.calls.length, 0)
})
process.env.PLATFORM_PAYSTACK_SECRET_KEY = PLATFORM_KEY

// ---------- the first payment ----------
let ref1
await check("checkout: our amount, the platform's key, card only, back to the shop's billing page", async () => {
  const r = await billingCall(B.checkout, { host: hostA, token: tokA, body: { plan: 'basic' } })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  assert.match(r.body.url, /^https:\/\/checkout\.paystack\.com\//)
  ref1 = r.body.reference
  const call = paystack.calls.at(-1)
  assert.equal(call.auth, `Bearer ${PLATFORM_KEY}`)
  assert.equal(call.body.amount, 500000)
  assert.deepEqual(call.body.channels, ['card'])
  assert.equal(call.body.callback_url, 'https://amaka-kitchen.shopsy.ng/admin/billing')
  const pending = await BillingPayment.findOne({ reference: ref1 })
  assert.equal(pending.status, 'pending')
  assert.equal(pending.amount, 5000)
})
await check('a plan name from the browser must be real', async () => {
  assert.equal((await billingCall(B.checkout, { host: hostA, token: tokA, body: { plan: 'free' } })).statusCode, 400)
})
await check('paying during the trial: the month starts when the trial ends (no lost days)', async () => {
  const r = await billingCall(B.confirm, { host: hostA, token: tokA, body: { reference: ref1 } })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  const s = await reload('amaka-kitchen')
  const expected = billing.addMonth(s.trialEndsAt)
  assert.equal(new Date(s.currentPeriodEnd).getTime(), expected.getTime())
  assert.equal(s.plan, 'basic')
  assert.equal(s.billing.cardLast4, '4081')
  assert.ok(s.billing.authorizationEnc && !s.billing.authorizationEnc.includes('AUTH_secret_code'), 'card token stored encrypted')
  assert.ok(emails.some((e) => /Receipt: ₦5,000/.test(e.subject) && e.to === 'amaka@x.ng'))
})
await check('confirming twice, or the webhook arriving too, never adds a second month', async () => {
  const before = (await reload('amaka-kitchen')).currentPeriodEnd
  await billingCall(B.confirm, { host: hostA, token: tokA, body: { reference: ref1 } })
  const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { ...paystack.txs.get(ref1) } }))
  const req = { headers: { 'x-paystack-signature': crypto.createHmac('sha512', PLATFORM_KEY).update(raw).digest('hex') }, body: JSON.parse(raw), rawBody: raw }
  const res = response()
  await B.billingWebhook(req, res)
  assert.equal(res.statusCode, 200)
  assert.equal(new Date((await reload('amaka-kitchen')).currentPeriodEnd).getTime(), new Date(before).getTime())
  assert.equal(await BillingPayment.countDocuments({ reference: ref1, status: 'paid' }), 1)
})
await check("webhooks not signed with the platform's key are refused", async () => {
  const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'x', metadata: { kind: 'subscription' } } }))
  for (const key of ['sk_test_merchant_key_aaaaaaaaaaaa', 'wrong']) {
    const res = response()
    await B.billingWebhook({ headers: { 'x-paystack-signature': crypto.createHmac('sha512', key).update(raw).digest('hex') }, body: JSON.parse(raw), rawBody: raw }, res)
    assert.equal(res.statusCode, 401)
  }
})
await check('a different amount than we asked for is refused', async () => {
  paystack.amountOverride = 100 // ₦1
  const r = await billingCall(B.checkout, { host: hostB, token: tokB, body: { plan: 'pro' } })
  paystack.amountOverride = null
  const c = await billingCall(B.confirm, { host: hostB, token: tokB, body: { reference: r.body.reference } })
  assert.equal(c.statusCode, 400)
  assert.equal((await BillingPayment.findOne({ reference: r.body.reference })).status, 'failed')
  assert.equal((await reload('bola-gadgets')).currentPeriodEnd, null)
})
await check("you can't confirm, or see, another shop's payment", async () => {
  assert.equal((await billingCall(B.confirm, { host: hostB, token: tokB, body: { reference: ref1 } })).statusCode, 400)
  assert.equal((await billingCall(B.getBilling, { host: hostA, token: tokB })).statusCode, 403)
  const mine = await billingCall(B.getBilling, { host: hostB, token: tokB })
  assert.ok(mine.body.history.every((p) => p.reference !== ref1))
})

// ---------- changing plan ----------
await check('before paying, switching plan is free and immediate', async () => {
  const r = await billingCall(B.changePlan, { host: hostB, token: tokB, body: { plan: 'pro' } })
  assert.equal(r.body.plan, 'pro')
  assert.equal((await reload('bola-gadgets')).plan, 'pro')
})
await check('upgrade when paid: pay only the difference for the days left', async () => {
  // Amaka: paid on Basic, 15 days left
  await setStore('amaka-kitchen', { trialEndsAt: new Date(now - DAY), currentPeriodEnd: new Date(now + 15 * DAY - 60000) })
  assert.equal((await billingCall(B.changePlan, { host: hostA, token: tokA, body: { plan: 'pro' } })).statusCode, 400)
  const r = await billingCall(B.checkout, { host: hostA, token: tokA, body: { plan: 'pro' } })
  assert.equal(r.body.kind, 'upgrade')
  assert.equal(r.body.amount, 3500) // (12000 - 5000) × 15/30
  await billingCall(B.confirm, { host: hostA, token: tokA, body: { reference: r.body.reference } })
  const s = await reload('amaka-kitchen')
  assert.equal(s.plan, 'pro')
  assert.equal(new Date(s.currentPeriodEnd).getTime(), now + 15 * DAY - 60000, 'paid-until unchanged')
})
await check('downgrade when paid: keeps Pro until renewal, can be cancelled', async () => {
  const r = await billingCall(B.changePlan, { host: hostA, token: tokA, body: { plan: 'basic' } })
  assert.equal(r.body.plan, 'pro')
  assert.equal(r.body.nextPlan, 'basic')
  assert.equal((await billingCall(B.changePlan, { host: hostA, token: tokA, body: { plan: 'pro' } })).body.nextPlan, null)
  await billingCall(B.changePlan, { host: hostA, token: tokA, body: { plan: 'basic' } })
})

// ---------- renewals ----------
await check("renewal charges the saved card at TODAY's Render price, and applies the downgrade", async () => {
  process.env.PLAN_BASIC_PRICE = '6500'
  await setStore('amaka-kitchen', { currentPeriodEnd: new Date(now + 12 * 60 * 60 * 1000), 'billing.lastAttemptAt': null })
  paystack.calls.length = 0
  const summary = await billing.runBillingCycle(new Date(now))
  assert.equal(summary.renewed, 1)
  const call = paystack.calls.find((c) => c.url.endsWith('/charge_authorization'))
  assert.equal(call.body.amount, 650000)
  assert.equal(call.body.authorization_code, 'AUTH_secret_code')
  assert.equal(call.auth, `Bearer ${PLATFORM_KEY}`)
  const s = await reload('amaka-kitchen')
  assert.equal(s.plan, 'basic')
  assert.equal(s.billing.nextPlan, null)
  assert.equal(new Date(s.currentPeriodEnd).getTime(), billing.addMonth(new Date(now + 12 * 60 * 60 * 1000)).getTime())
})
await check('not due yet: nothing is charged', async () => {
  paystack.calls.length = 0
  assert.equal((await billing.runBillingCycle(new Date(now))).renewed, 0)
  assert.equal(paystack.calls.length, 0)
})
await check('a declined card: shop stays open in grace, owner emailed, retried once a day', async () => {
  const end = new Date(now - 2 * DAY)
  await setStore('amaka-kitchen', { currentPeriodEnd: end, 'billing.lastAttemptAt': null })
  paystack.chargeResult = 'failed'
  emails.length = 0
  const first = await billing.runBillingCycle(new Date(now))
  assert.equal(first.failed, 1)
  assert.equal(storeState(await reload('amaka-kitchen'), new Date(now)).state, 'grace')
  assert.ok(emails.some((e) => /Payment failed/.test(e.subject)))
  paystack.calls.length = 0
  assert.equal((await billing.runBillingCycle(new Date(now + 3 * 60 * 60 * 1000))).failed, 0, 'not again within a day')
  assert.equal(paystack.calls.length, 0)
  assert.equal((await billing.runBillingCycle(new Date(now + DAY))).failed, 1, 'tried again the next day')
})
await check('after the grace period: paused (visitors locked out, data kept), one email', async () => {
  const end = new Date(now - 8 * DAY)
  await setStore('amaka-kitchen', { currentPeriodEnd: end })
  emails.length = 0
  await billing.runBillingCycle(new Date(now))
  await billing.runBillingCycle(new Date(now + 60 * 60 * 1000))
  assert.equal(emails.filter((e) => /is paused/.test(e.subject)).length, 1)
  assert.equal((await run([P.getProducts], { host: hostA })).statusCode, 403)
  assert.ok((await Product.countDocuments({ store: (await reload('amaka-kitchen'))._id })) > 0)
})
await check('a paused shop that pays is open again straight away', async () => {
  paystack.chargeResult = 'success'
  const r = await billingCall(B.checkout, { host: hostA, token: tokA, body: { plan: 'basic' } })
  await billingCall(B.confirm, { host: hostA, token: tokA, body: { reference: r.body.reference } })
  forgetStore()
  assert.equal((await run([P.getProducts], { host: hostA })).statusCode, 200)
  const s = await reload('amaka-kitchen')
  assert.ok(new Date(s.currentPeriodEnd) > new Date(now + 27 * DAY))
})
await check('auto-renew off: the month just runs out, no charge', async () => {
  await billingCall(B.setAutoRenew, { host: hostA, token: tokA, body: { on: false } })
  await setStore('amaka-kitchen', { currentPeriodEnd: new Date(now + 60 * 60 * 1000), 'billing.lastAttemptAt': null })
  paystack.calls.length = 0
  await billing.runBillingCycle(new Date(now))
  assert.equal(paystack.calls.length, 0)
  await billingCall(B.setAutoRenew, { host: hostA, token: tokA, body: { on: true } })
})

// ---------- trial reminders ----------
await check('trial reminders at 3 days and 1 day, once each; none if a paid month is lined up', async () => {
  await setStore('bola-gadgets', { publishedAt: new Date(now - 4 * DAY), trialEndsAt: new Date(now + 3 * DAY - 60000), currentPeriodEnd: null })
  emails.length = 0
  await billing.runBillingCycle(new Date(now))
  await billing.runBillingCycle(new Date(now + 60 * 60 * 1000))
  assert.equal(emails.filter((e) => /trial ends in 3 days/.test(e.subject)).length, 1)
  await billing.runBillingCycle(new Date(now + 2 * DAY + 60000))
  assert.equal(emails.filter((e) => /trial ends in 1 day/.test(e.subject)).length, 1)
  // with a paid month after the trial, no reminders
  await setStore('bola-gadgets', { trialEndsAt: new Date(now + 2 * DAY), currentPeriodEnd: new Date(now + 32 * DAY), 'billing.reminders': {} })
  emails.length = 0
  await billing.runBillingCycle(new Date(now))
  assert.equal(emails.filter((e) => /trial/.test(e.subject)).length, 0)
})
await check('trial over without paying: paused, no grace period', async () => {
  await setStore('bola-gadgets', { trialEndsAt: new Date(now - 60000), currentPeriodEnd: null })
  assert.equal(storeState(await reload('bola-gadgets'), new Date(now)).state, 'paused')
})

// ---------- odds and ends ----------
await check('months follow the calendar (31 January + 1 month = end of February)', () => {
  assert.equal(billing.addMonth(new Date('2027-01-31T10:00:00Z')).toISOString(), '2027-02-28T10:00:00.000Z')
  assert.equal(billing.addMonth(new Date('2028-01-31T10:00:00Z')).toISOString(), '2028-02-29T10:00:00.000Z')
  assert.equal(billing.addMonth(new Date('2027-12-15T00:00:00Z')).toISOString(), '2028-01-15T00:00:00.000Z')
})
await check('the billing page shows plan, prices from Render, card and history', async () => {
  const r = await billingCall(B.getBilling, { host: hostA, token: tokA })
  assert.equal(r.body.prices.basic, 6500)
  assert.equal(r.body.card.last4, '4081')
  assert.ok(r.body.history.length >= 3)
  assert.ok(r.body.history.some((p) => p.status === 'failed'))
})

console.log(`${FAKE ? '[in-memory] ' : '[MongoDB] '}${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL', f)
if (!FAKE) {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}
process.exit(failures.length ? 1 : 0)
