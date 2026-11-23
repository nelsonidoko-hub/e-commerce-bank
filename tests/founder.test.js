// Phase 5 tests: the founder dashboard, custom domains, platform password
// reset and the sign-up terms. Uses fake DNS and a fake Vercel API.
//
//   npm run test:founder
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
const BillingPayment = (await imp('models/BillingPayment.js')).default
const PlatformAction = (await imp('models/PlatformAction.js')).default
const { resolveStore, storeOpen, forgetStore, findStore } = await imp('middleware/storeMiddleware.js')
const { protect, admin, optionalLogin } = await imp('middleware/authMiddleware.js')
const PL = await imp('controllers/platformController.js')
const F = await imp('controllers/founderController.js')
const D = await imp('controllers/domainController.js')
const P = await imp('controllers/productController.js')
const ST = await imp('controllers/storeController.js')
const { setTxtResolver, normalizeDomain } = await imp('utils/domains.js')
const { storeUrl } = await imp('utils/storeUrl.js')
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
const founder = (fn, opts) => run([PL.platformProtect, F.superadminOnly, fn], opts, false)
const DAY = 864e5
const now = Date.now()

if (FAKE) mg.__reset()
else {
  await mongoose.connection.dropDatabase()
  for (const m of Object.values(mongoose.models)) await m.syncIndexes()
}
forgetStore()

// The founder (superadmin), three merchants in different states, and demos
await seedDemos({ email: 'founder@shopsy.ng', password: 'founder-pass-1234', log: () => {} })
const founderTok = (await run([PL.login], { body: { email: 'founder@shopsy.ng', password: 'founder-pass-1234' } }, false)).body.token
const signup = async (name, shopName, body = {}) =>
  run([PL.signup], { body: { acceptTerms: true, name, email: `${name}@x.ng`, password: `${name}-pass-123`, shopName, ...body } }, false)
const amaka = (await signup('amaka', 'Amaka Kitchen')).body
const bola = (await signup('bola', 'Bola Gadgets')).body
await signup('chidi', 'Chidi Draft')
const set = async (slug, values) => { await Store.updateOne({ slug }, { $set: values }); forgetStore() }
await set('amaka-kitchen', { publishedAt: new Date(now - 30 * DAY), plan: 'pro', currentPeriodEnd: new Date(now + 10 * DAY) }) // active
await set('bola-gadgets', { publishedAt: new Date(now - 5 * DAY), trialEndsAt: new Date(now + 2 * DAY) }) // trial ending
const amakaId = String((await Store.findOne({ slug: 'amaka-kitchen' }))._id)
const bolaId = String((await Store.findOne({ slug: 'bola-gadgets' }))._id)
const thisMonth = new Date()
const lastMonth = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1, 15))
await BillingPayment.create({ store: amakaId, reference: 'r1', kind: 'subscribe', plan: 'pro', amount: 12000, status: 'paid', paidAt: thisMonth })
await BillingPayment.create({ store: amakaId, reference: 'r0', kind: 'subscribe', plan: 'basic', amount: 5000, status: 'paid', paidAt: lastMonth })
await BillingPayment.create({ store: bolaId, reference: 'r2', kind: 'renewal', plan: 'basic', amount: 5000, status: 'failed', failureReason: 'Insufficient Funds' })

// ---------- who can see it ----------
await check('only the founder: merchants get 403, visitors 401', async () => {
  assert.equal((await founder(F.overview, { token: amaka.account.token })).statusCode, 403)
  assert.equal((await founder(F.overview, {})).statusCode, 401)
  assert.equal((await founder(F.overview, { token: founderTok })).statusCode, 200)
})

// ---------- overview ----------
await check('overview: shops by state, income, monthly recurring, trials ending, failed payments (demos excluded)', async () => {
  const o = (await founder(F.overview, { token: founderTok })).body
  assert.equal(o.shops, 3)
  assert.equal(o.states.active, 1)
  assert.equal(o.states.trial, 1)
  assert.equal(o.states.draft, 1)
  assert.equal(o.income.thisMonth, 12000)
  assert.equal(o.income.lastMonth, 5000)
  assert.equal(o.income.monthlyRecurring, 12000)
  assert.deepEqual(o.trialsEnding.map((s) => s.slug), ['bola-gadgets'])
  assert.equal(o.trialsEnding[0].ownerEmail, 'bola@x.ng')
  assert.equal(o.failedPayments[0].storeName, 'Bola Gadgets')
  assert.equal(o.failedPayments[0].reason, 'Insufficient Funds')
})
await check('shops: search by owner email or name, filter by state, details', async () => {
  const byEmail = (await founder(F.listShops, { token: founderTok, query: { q: 'bola@x' } })).body
  assert.deepEqual(byEmail.shops.map((s) => s.slug), ['bola-gadgets'])
  assert.deepEqual((await founder(F.listShops, { token: founderTok, query: { q: 'kitchen' } })).body.shops.map((s) => s.slug), ['amaka-kitchen'])
  assert.deepEqual((await founder(F.listShops, { token: founderTok, query: { state: 'draft' } })).body.shops.map((s) => s.slug), ['chidi-draft'])
  assert.equal((await founder(F.listShops, { token: founderTok, query: { q: '.*' } })).body.total, 0, 'search text is not a pattern')
  const d = (await founder(F.getShop, { token: founderTok, params: { id: amakaId } })).body
  assert.equal(d.ownerEmail, 'amaka@x.ng')
  assert.equal(d.counts.products, 6)
  assert.equal(d.payments.length, 2)
  assert.equal((await founder(F.getShop, { token: founderTok, params: { id: 'nope' } })).statusCode, 404)
})

// ---------- actions ----------
await check('suspend needs a reason; visitors then see "unavailable", the owner sees why', async () => {
  assert.equal((await founder(F.shopAction, { token: founderTok, params: { id: amakaId }, body: { action: 'suspend' } })).statusCode, 400)
  const r = await founder(F.shopAction, { token: founderTok, params: { id: amakaId }, body: { action: 'suspend', reason: 'Selling counterfeit goods' } })
  assert.equal(r.body.state, 'suspended')
  const visitor = await run([P.getProducts], { host: 'amaka-kitchen.shopsy.ng' })
  assert.equal(visitor.statusCode, 403)
  assert.equal(visitor.body.state, 'unavailable')
  const owner = await run([optionalLogin, ST.getStoreStatus], { host: 'amaka-kitchen.shopsy.ng', token: amaka.account.token, url: '/api/store/status' })
  assert.equal(owner.body.manage?.suspendedReason, 'Selling counterfeit goods')
})
await check('restore', async () => {
  const r = await founder(F.shopAction, { token: founderTok, params: { id: amakaId }, body: { action: 'unsuspend' } })
  assert.equal(r.body.state, 'active')
  assert.equal((await run([P.getProducts], { host: 'amaka-kitchen.shopsy.ng' })).statusCode, 200)
})
await check('extend a trial (1-60 days, published shops only)', async () => {
  const before = (await Store.findById(bolaId)).trialEndsAt
  const r = await founder(F.shopAction, { token: founderTok, params: { id: bolaId }, body: { action: 'extend-trial', days: 7 } })
  assert.equal(r.statusCode, 200)
  assert.equal(new Date(r.body.trialEndsAt).getTime(), new Date(before).getTime() + 7 * DAY)
  assert.equal((await founder(F.shopAction, { token: founderTok, params: { id: bolaId }, body: { action: 'extend-trial', days: 99 } })).statusCode, 400)
  const draft = (await Store.findOne({ slug: 'chidi-draft' }))._id
  assert.equal((await founder(F.shopAction, { token: founderTok, params: { id: String(draft) }, body: { action: 'extend-trial', days: 7 } })).statusCode, 400)
})
await check('free months: paid-until moves on, a ₦0 gift is recorded, not counted as income', async () => {
  const r = await founder(F.shopAction, { token: founderTok, params: { id: bolaId }, body: { action: 'free-months', months: 2 } })
  assert.equal(r.statusCode, 200)
  assert.ok(new Date(r.body.currentPeriodEnd) > new Date(now + 60 * DAY))
  assert.equal(r.body.payments[0].kind, 'gift')
  assert.equal(r.body.payments[0].amount, 0)
  assert.equal((await founder(F.overview, { token: founderTok })).body.income.thisMonth, 12000)
})
await check('change plan, and demos are left alone', async () => {
  assert.equal((await founder(F.shopAction, { token: founderTok, params: { id: bolaId }, body: { action: 'plan', plan: 'pro' } })).body.plan, 'pro')
  const demo = (await Store.findOne({ slug: 'demo-fresh' }))._id
  assert.equal((await founder(F.shopAction, { token: founderTok, params: { id: String(demo) }, body: { action: 'suspend', reason: 'x' } })).statusCode, 400)
  assert.equal((await founder(F.shopAction, { token: founderTok, params: { id: bolaId }, body: { action: 'delete-everything' } })).statusCode, 400)
})
await check('every action is logged with who did it', async () => {
  const log = await PlatformAction.find({}).sort({ createdAt: 1 }).lean()
  assert.deepEqual(log.map((a) => a.action), ['suspend', 'unsuspend', 'extend-trial', 'free-months', 'plan'])
  assert.ok(log.every((a) => a.byEmail === 'founder@shopsy.ng'))
  assert.equal(log[0].details, 'Selling counterfeit goods')
  assert.ok((await founder(F.overview, { token: founderTok })).body.recentActions.length >= 5)
})

// ---------- custom domains ----------
const hostA = 'amaka-kitchen.shopsy.ng'
const txt = new Map()
setTxtResolver(async (name) => {
  if (!txt.has(name)) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
  return [[txt.get(name)]]
})
await check('domain names are cleaned and checked', () => {
  assert.equal(normalizeDomain('https://WWW.AmakaKitchen.com/shop?x=1'), 'amakakitchen.com')
  for (const bad of ['amaka', 'shopsy.ng', 'x.shopsy.ng', 'evil.vercel.app', '-bad.com', 'a b.com', 'localhost']) {
    assert.throws(() => normalizeDomain(bad), undefined, bad)
  }
})
await check('custom domains are a Pro feature', async () => {
  await set('bola-gadgets', { plan: 'basic' })
  const r = await run([protect, admin, D.setDomain], { host: 'bola-gadgets.shopsy.ng', token: bola.account.token, body: { domain: 'bola.com' } })
  assert.equal(r.statusCode, 403)
})
let token
await check('set a domain: saved unverified, with DNS records to add', async () => {
  const r = await run([protect, admin, D.setDomain], { host: hostA, token: amaka.account.token, body: { domain: 'www.amakakitchen.com' } })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  assert.equal(r.body.domain, 'amakakitchen.com')
  assert.equal(r.body.verified, false)
  const txtRecord = r.body.records.find((x) => x.type === 'TXT')
  assert.equal(txtRecord.name, '_shopverify.amakakitchen.com')
  token = txtRecord.value
  assert.match(token, /^shop-verify-[0-9a-f]{24}$/)
  // not live until verified
  assert.equal(await findStore({ host: 'amakakitchen.com' }), null)
})
await check("you can't claim another shop's domain", async () => {
  await set('bola-gadgets', { plan: 'pro' })
  const r = await run([protect, admin, D.setDomain], { host: 'bola-gadgets.shopsy.ng', token: bola.account.token, body: { domain: 'amakakitchen.com' } })
  assert.equal(r.statusCode, 400)
  assert.match(r.body.message, /another shop/)
})
await check('verify: refused without the right TXT record', async () => {
  const missing = await run([protect, admin, D.verifyDomain], { host: hostA, token: amaka.account.token })
  assert.equal(missing.statusCode, 400)
  assert.match(missing.body.message, /couldn't find/)
  txt.set('_shopverify.amakakitchen.com', 'shop-verify-wrong')
  const wrong = await run([protect, admin, D.verifyDomain], { host: hostA, token: amaka.account.token })
  assert.match(wrong.body.message, /doesn't match/)
})
await check('verify: with the record, the domain goes live and is added to Vercel', async () => {
  txt.set('_shopverify.amakakitchen.com', token)
  vercel.length = 0
  const r = await run([protect, admin, D.verifyDomain], { host: hostA, token: amaka.account.token })
  assert.equal(r.statusCode, 200, JSON.stringify(r.body))
  assert.equal(r.body.verified, true)
  assert.equal(r.body.hosting, 'added')
  assert.deepEqual(vercel.map((c) => c.body?.name), ['amakakitchen.com', 'www.amakakitchen.com'])
  assert.match(vercel[0].url, /\/v10\/projects\/prj_test\/domains/)
  assert.equal(String((await findStore({ host: 'www.amakakitchen.com' }))._id), amakaId)
  assert.equal(storeUrl(await Store.findById(amakaId).lean(), '/shop'), 'https://amakakitchen.com/shop')
  assert.equal((await run([P.getProducts], { host: 'amakakitchen.com' })).statusCode, 200)
})
await check('downgrading to Basic switches the domain off (the platform address still works)', async () => {
  await set('amaka-kitchen', { plan: 'basic' })
  assert.equal(await findStore({ host: 'amakakitchen.com' }), null)
  assert.equal(storeUrl(await Store.findById(amakaId).lean(), '/shop'), 'https://amaka-kitchen.shopsy.ng/shop')
  assert.equal((await run([P.getProducts], { host: hostA })).statusCode, 200)
  await set('amaka-kitchen', { plan: 'pro' })
})
await check('remove the domain: removed from Vercel too', async () => {
  vercel.length = 0
  const r = await run([protect, admin, D.removeDomain], { host: hostA, token: amaka.account.token })
  assert.equal(r.body.domain, '')
  assert.equal(await findStore({ host: 'amakakitchen.com' }), null)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.ok(vercel.every((c) => c.method === 'delete'))
  assert.equal(vercel.length, 2)
})
await check('changing a live domain takes the old one off Vercel and out of service', async () => {
  const set1 = await run([protect, admin, D.setDomain], { host: hostA, token: amaka.account.token, body: { domain: 'amakakitchen.com' } })
  txt.set('_shopverify.amakakitchen.com', set1.body.records.find((x) => x.type === 'TXT').value)
  assert.equal((await run([protect, admin, D.verifyDomain], { host: hostA, token: amaka.account.token })).body.verified, true)
  vercel.length = 0
  const r = await run([protect, admin, D.setDomain], { host: hostA, token: amaka.account.token, body: { domain: 'amakafoods.com' } })
  assert.equal(r.body.verified, false)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(vercel.filter((c) => c.method === 'delete' && /amakakitchen\.com/.test(c.url)).length, 2)
  assert.equal(await findStore({ host: 'amakakitchen.com' }), null)
  await run([protect, admin, D.removeDomain], { host: hostA, token: amaka.account.token })
})
await check("other merchants can't touch your domain settings", async () => {
  assert.equal((await run([protect, admin, D.setDomain], { host: hostA, token: bola.account.token, body: { domain: 'x.com' } })).statusCode, 403)
})

// ---------- platform password reset ----------
await check('forgot password on the platform: email with link, works once, signs in', async () => {
  emails.length = 0
  const r = await run([PL.forgotPassword], { body: { email: 'amaka@x.ng' } }, false)
  assert.equal(r.statusCode, 200)
  const link = emails[0].html.match(/href="([^"]+reset-password\/[0-9a-f]+)"/)?.[1]
  assert.match(link, /^https:\/\/shopsy\.ng\/reset-password\//)
  const raw = link.split('/').pop()
  const ok = await run([PL.resetPassword], { body: { token: raw, password: 'brand-new-pass-1' } }, false)
  assert.equal(ok.statusCode, 200)
  assert.ok(ok.body.token)
  assert.equal((await run([PL.resetPassword], { body: { token: raw, password: 'another-pass-12' } }, false)).statusCode, 400)
  assert.equal((await run([PL.login], { body: { email: 'amaka@x.ng', password: 'brand-new-pass-1' } }, false)).statusCode, 200)
})
await check('an old reset link (over 30 minutes) is refused', async () => {
  emails.length = 0
  await run([PL.forgotPassword], { body: { email: 'bola@x.ng' } }, false)
  await new Promise((resolve) => setTimeout(resolve, 20))
  const raw = emails[0].html.match(/reset-password\/([0-9a-f]+)/)[1]
  await User.updateOne({ email: 'bola@x.ng', store: null }, { $set: { resetTokenExpires: new Date(Date.now() - 1000) } })
  assert.equal((await run([PL.resetPassword], { body: { token: raw, password: 'brand-new-pass-1' } }, false)).statusCode, 400)
})
await check("same answer for unknown emails; shop customers aren't platform accounts", async () => {
  emails.length = 0
  const store = await Store.findById(amakaId)
  await User.create({ store: store._id, role: 'customer', name: 'Cust', email: 'cust@x.ng', password: 'cust-pass-12' })
  const a = await run([PL.forgotPassword], { body: { email: 'nobody@x.ng' } }, false)
  const b = await run([PL.forgotPassword], { body: { email: 'cust@x.ng' } }, false)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(a.body.message, b.body.message)
  assert.equal(emails.length, 0)
})

// ---------- terms ----------
await check('sign-up needs the terms accepted, and records when', async () => {
  const r = await run([PL.signup], { body: { name: 'Dayo', email: 'dayo@x.ng', password: 'dayo-pass-123', shopName: 'Dayo Shop' } }, false)
  assert.equal(r.statusCode, 400)
  assert.equal(r.body.field, 'terms')
  assert.equal(await User.countDocuments({ email: 'dayo@x.ng' }), 0)
  const ok = await signup('dayo', 'Dayo Shop')
  assert.equal(ok.statusCode, 201)
  assert.ok((await User.findOne({ email: 'dayo@x.ng' })).termsAcceptedAt)
})

console.log(`${FAKE ? '[in-memory] ' : '[MongoDB] '}${passed} passed, ${failures.length} failed`)
for (const f of failures) console.log('  FAIL', f)
if (!FAKE) {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
  server.close()
}
process.exit(failures.length ? 1 : 0)
