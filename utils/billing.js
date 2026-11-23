import crypto from 'crypto'
import axios from 'axios'
import Store from '../models/Store.js'
import User from '../models/User.js'
import BillingPayment from '../models/BillingPayment.js'
import { getPlans, trialDays, graceDays } from './plans.js'
import { storeState } from './storeAccess.js'
import { storeUrl } from './storeUrl.js'
import { paystackApi } from './paystackConfig.js'
import { encrypt, decrypt, encryptionReady } from '../config/secretBox.js'
import { forgetStore } from '../middleware/storeMiddleware.js'
import { sendBillingEmail } from './email.js'

// Merchants paying the platform: monthly Basic or Pro.
//
// Money goes to the PLATFORM's own Paystack account
// (PLATFORM_PAYSTACK_SECRET_KEY on Render), never a merchant's.
//
// Rules:
//  - The first payment can be made any time. During the free trial, the paid
//    month starts when the trial ends, so no trial days are lost.
//  - The card is saved (as Paystack's reusable token, encrypted here) and
//    charged automatically a day before each month ends, at the price set on
//    Render THAT day. Turning auto-renew off just lets the month run out.
//  - A failed renewal is retried once a day during the grace period
//    (GRACE_DAYS); after that the shop pauses until paid. Nothing is deleted.
//  - Upgrade to Pro: immediate, charging only the difference for the days left.
//    Downgrade to Basic: takes effect at the next renewal.
//  - Every payment is first saved as "pending" with the amount WE decided, and
//    only marked paid if Paystack confirms that exact amount in Naira, once.

const DAY = 24 * 60 * 60 * 1000
export const MIN_UPGRADE_CHARGE = 100 // ₦, Paystack won't take tiny amounts

export class BillingError extends Error {}

export const platformKey = () => (process.env.PLATFORM_PAYSTACK_SECRET_KEY || '').trim()
export const billingReady = () => Boolean(platformKey())
const headers = () => ({ Authorization: `Bearer ${platformKey()}` })

// One calendar month later (31 Jan + 1 month = 28/29 Feb, not 3 Mar)
export function addMonth(date) {
  const d = new Date(date)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + 1)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, last))
  return d
}

const priceOf = (plan) => getPlans()[plan]?.price ?? getPlans().basic.price
const newReference = (kind) => `sub_${kind}_${crypto.randomBytes(9).toString('hex')}`

// When a new paid month would start: after any time already paid, and after
// the free trial, whichever is later (never in the past)
export function nextPeriodStart(store, now = new Date()) {
  const t = now.getTime()
  const paid = store.currentPeriodEnd ? new Date(store.currentPeriodEnd).getTime() : 0
  const trial = store.trialEndsAt ? new Date(store.trialEndsAt).getTime() : 0
  return new Date(Math.max(t, paid, trial))
}

// Is the shop paid up right now (not trial, not grace)?
const isPaidNow = (store, now = new Date()) => Boolean(store.currentPeriodEnd && new Date(store.currentPeriodEnd) > now)
export const isPaidNowFor = isPaidNow

// What a checkout for `plan` would charge, and what kind of payment it is
export function quote(store, plan, now = new Date()) {
  const plans = getPlans()
  if (!plans[plan]) throw new BillingError('Choose Basic or Pro')

  // Already paid up on Basic, moving to Pro: pay the difference for the days left
  if (isPaidNow(store, now) && store.plan === 'basic' && plan === 'pro') {
    const daysLeft = Math.ceil((new Date(store.currentPeriodEnd) - now) / DAY)
    const amount = Math.max(MIN_UPGRADE_CHARGE, Math.round(((plans.pro.price - plans.basic.price) * daysLeft) / 30))
    return { kind: 'upgrade', plan, amount, daysLeft }
  }
  if (isPaidNow(store, now) && store.plan === plan) {
    // paying early for the next month on the same plan
    return { kind: 'subscribe', plan, amount: plans[plan].price, startsAt: nextPeriodStart(store, now) }
  }
  if (isPaidNow(store, now) && store.plan === 'pro' && plan === 'basic') {
    throw new BillingError('To move to Basic, choose "Switch at renewal". You keep Pro until then.')
  }
  return { kind: 'subscribe', plan, amount: plans[plan].price, startsAt: nextPeriodStart(store, now) }
}

// ---------- paying with Paystack checkout ----------

// Starts a payment: saves it as pending, then asks Paystack for a checkout page
export async function startCheckout(store, plan, ownerEmail) {
  if (!billingReady()) throw new BillingError('Payments to the platform are not set up yet. Please try again later.')
  if (store.isDemo) throw new BillingError('Demo shops are not billed')
  const q = quote(store, plan)
  const reference = newReference(q.kind)

  await BillingPayment.create({ store: store._id, reference, kind: q.kind, plan, amount: q.amount })

  const { data } = await axios.post(
    `${paystackApi()}/transaction/initialize`,
    {
      email: ownerEmail,
      amount: q.amount * 100,
      currency: 'NGN',
      reference,
      // card only: that's what can be charged again automatically
      channels: ['card'],
      callback_url: storeUrl(store, '/admin/billing'),
      metadata: { kind: 'subscription', storeId: String(store._id), plan, paymentKind: q.kind },
    },
    { headers: headers(), timeout: 15000 }
  )
  return { url: data.data.authorization_url, reference, ...q }
}

// Paystack's view of a payment, checked against what we expected
async function fetchTransaction(reference) {
  const { data } = await axios.get(`${paystackApi()}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: headers(),
    timeout: 15000,
  })
  return data.data
}

// Marks a pending payment paid and moves the shop forward. Safe to call twice
// (browser return + webhook): only the first call does anything.
export async function applyPayment(reference, tx) {
  const pending = await BillingPayment.findOne({ reference })
  if (!pending) return { ok: false, reason: 'unknown payment' }
  if (pending.status === 'paid') return { ok: true, already: true, payment: pending }

  // Only exactly what we asked for, in Naira, successfully
  if (!tx || tx.status !== 'success') return { ok: false, reason: 'not successful' }
  if (Number(tx.amount) !== Math.round(pending.amount * 100) || (tx.currency && tx.currency !== 'NGN')) {
    console.error(`Billing: amount mismatch on ${reference}: got ${tx.amount} ${tx.currency}, expected ${pending.amount * 100} NGN`)
    await BillingPayment.updateOne({ _id: pending._id, status: 'pending' }, { $set: { status: 'failed', failureReason: 'amount mismatch' } })
    return { ok: false, reason: 'amount mismatch' }
  }

  // Claim it, so a second caller arriving at the same moment does nothing
  const claimed = await BillingPayment.findOneAndUpdate(
    { _id: pending._id, status: 'pending' },
    { $set: { status: 'paid', paidAt: new Date() } },
    { returnDocument: 'after' }
  )
  if (!claimed) return { ok: true, already: true, payment: pending }

  const store = await Store.findById(pending.store)
  const now = new Date()
  const update = { failedAttempts: 0 }

  if (pending.kind === 'upgrade') {
    store.plan = 'pro'
  } else {
    store.plan = pending.plan
    store.currentPeriodEnd = addMonth(nextPeriodStart(store, now))
    if (store.billing.nextPlan === pending.plan) store.billing.nextPlan = null
  }
  // A paid shop that was never published stays a draft; publishing is the owner's choice

  // Save the card for automatic renewals
  const auth = tx.authorization
  if (auth?.reusable && auth.authorization_code && encryptionReady()) {
    store.billing.authorizationEnc = encrypt(auth.authorization_code)
    store.billing.cardLast4 = auth.last4 || ''
    store.billing.cardBrand = auth.card_type || auth.brand || ''
  }
  if (tx.customer?.email) store.billing.email = tx.customer.email
  Object.assign(store.billing, update)
  await store.save()
  forgetStore(store)

  await BillingPayment.updateOne({ _id: claimed._id }, { $set: { periodEnd: store.currentPeriodEnd } })
  sendBillingEmail(store, 'receipt', { payment: { ...claimed.toObject(), periodEnd: store.currentPeriodEnd } }).catch((e) =>
    console.error('Billing email error:', e.message)
  )
  return { ok: true, payment: claimed, store }
}

// The browser came back from Paystack: confirm with Paystack, then apply
export async function confirmCheckout(store, reference) {
  const pending = await BillingPayment.findOne({ reference, store: store._id })
  if (!pending) throw new BillingError('Payment not found')
  if (pending.status === 'paid') return { ok: true, already: true, payment: pending }
  const tx = await fetchTransaction(reference)
  return applyPayment(reference, tx)
}

// ---------- automatic renewals ----------

async function ownerEmail(store) {
  if (store.billing?.email) return store.billing.email
  const owner = await User.findById(store.owner).select('email').lean()
  return owner?.email || store.notifyEmail
}

// Charges the saved card for the next month. Returns 'paid' | 'failed' | 'skipped'
export async function renew(store, now = new Date()) {
  if (!store.billing?.authorizationEnc || !store.billing.autoRenew) return 'skipped'
  const plan = store.billing.nextPlan || store.plan
  const amount = priceOf(plan) // whatever Render says today
  const reference = newReference('renewal')
  await BillingPayment.create({ store: store._id, reference, kind: 'renewal', plan, amount })
  await Store.updateOne({ _id: store._id }, { $set: { 'billing.lastAttemptAt': now } })

  let tx
  try {
    const { data } = await axios.post(
      `${paystackApi()}/transaction/charge_authorization`,
      {
        email: await ownerEmail(store),
        amount: amount * 100,
        currency: 'NGN',
        reference,
        authorization_code: decrypt(store.billing.authorizationEnc),
        metadata: { kind: 'subscription', storeId: String(store._id), plan, paymentKind: 'renewal' },
      },
      { headers: headers(), timeout: 20000 }
    )
    tx = data.data
  } catch (error) {
    tx = { status: 'failed', gateway_response: error.response?.data?.message || error.message }
  }

  if (tx?.status === 'success') {
    const result = await applyPayment(reference, tx)
    if (result.ok) {
      // a scheduled downgrade has now happened
      await Store.updateOne({ _id: store._id }, { $set: { plan, 'billing.nextPlan': null } })
      forgetStore(store)
      return 'paid'
    }
  }

  await BillingPayment.updateOne(
    { reference, status: 'pending' },
    { $set: { status: 'failed', failureReason: String(tx?.gateway_response || 'declined').slice(0, 200) } }
  )
  await Store.updateOne({ _id: store._id }, { $inc: { 'billing.failedAttempts': 1 } })
  const fresh = await Store.findById(store._id).lean()
  const access = storeState(fresh, now)
  await remindOnce(fresh, `failed:${now.toISOString().slice(0, 10)}`, 'payment-failed', { until: access.until, now })
  return 'failed'
}

// ---------- reminders ----------

async function remindOnce(store, key, type, extra = {}) {
  if (store.billing?.reminders?.[key]) return false
  // record first, so two timers running together can't both send
  const res = await Store.updateOne(
    { _id: store._id, [`billing.reminders.${key}`]: { $exists: false } },
    { $set: { [`billing.reminders.${key}`]: new Date() } }
  )
  if (res.modifiedCount === 0) return false
  await sendBillingEmail(store, type, extra).catch((e) => console.error('Billing email error:', e.message))
  return true
}

// ---------- the hourly job ----------

// Renews shops that are due, retries failed ones once a day during grace,
// and sends trial and pause reminders. `now` is a parameter for testing.
export async function runBillingCycle(now = new Date()) {
  const t = now.getTime()
  const summary = { renewed: 0, failed: 0, reminders: 0 }
  if (!billingReady()) return summary

  // 1. Due for renewal: paid month ends within a day, or ended and still in grace
  const graceStart = new Date(t - graceDays() * DAY)
  const due = await Store.find({
    isDemo: { $ne: true },
    suspended: { $ne: true },
    'billing.autoRenew': true,
    'billing.authorizationEnc': { $nin: ['', null] },
    currentPeriodEnd: { $lte: new Date(t + DAY), $gt: graceStart },
    $or: [{ 'billing.lastAttemptAt': null }, { 'billing.lastAttemptAt': { $lte: new Date(t - 23 * 60 * 60 * 1000) } }],
  })
  for (const store of due) {
    const result = await renew(store, now)
    if (result === 'paid') summary.renewed++
    if (result === 'failed') summary.failed++
  }

  // 2. Free trial ending soon, and no paid month lined up
  const trials = await Store.find({
    isDemo: { $ne: true },
    publishedAt: { $ne: null },
    trialEndsAt: { $gt: now, $lte: new Date(t + 3 * DAY) },
  }).lean()
  for (const store of trials) {
    if (store.currentPeriodEnd && new Date(store.currentPeriodEnd) > new Date(store.trialEndsAt)) continue
    const daysLeft = Math.ceil((new Date(store.trialEndsAt) - now) / DAY)
    const key = `trial-${daysLeft <= 1 ? 1 : 3}:${new Date(store.trialEndsAt).toISOString().slice(0, 10)}`
    if (await remindOnce(store, key, 'trial-ending', { daysLeft, until: store.trialEndsAt, now })) summary.reminders++
  }

  // 3. Shops that have just paused (trial over, or grace over)
  const recent = await Store.find({
    isDemo: { $ne: true },
    publishedAt: { $ne: null },
    $or: [
      { trialEndsAt: { $lte: now, $gt: new Date(t - 3 * DAY) } },
      { currentPeriodEnd: { $lte: graceStart, $gt: new Date(graceStart.getTime() - 3 * DAY) } },
    ],
  }).lean()
  for (const store of recent) {
    if (storeState(store, now).state !== 'paused') continue
    const ended = store.currentPeriodEnd || store.trialEndsAt
    if (await remindOnce(store, `paused:${new Date(ended).toISOString().slice(0, 10)}`, 'paused', { now })) summary.reminders++
  }
  return summary
}

export function startBillingJob() {
  if (!billingReady()) {
    console.warn('Billing: PLATFORM_PAYSTACK_SECRET_KEY is not set, so subscriptions are switched off.')
    return
  }
  const run = () => runBillingCycle().catch((e) => console.error('Billing job error:', e.message))
  run()
  setInterval(run, 60 * 60 * 1000)
}

// For the Billing page
export function billingSummary(store, now = new Date()) {
  const plans = getPlans()
  const access = storeState(store, now)
  return {
    ready: billingReady(),
    state: access.state,
    until: access.until || null,
    plan: store.plan,
    nextPlan: store.billing?.nextPlan || null,
    autoRenew: store.billing?.autoRenew !== false,
    card: store.billing?.cardLast4 ? { last4: store.billing.cardLast4, brand: store.billing.cardBrand } : null,
    currentPeriodEnd: store.currentPeriodEnd || null,
    trialEndsAt: store.trialEndsAt || null,
    trialDays: trialDays(),
    graceDays: graceDays(),
    prices: { basic: plans.basic.price, pro: plans.pro.price },
    basicProductLimit: plans.basic.productLimit,
    upgradeQuote: store.plan === 'basic' && isPaidNow(store, now) ? quote(store, 'pro', now).amount : null,
  }
}
