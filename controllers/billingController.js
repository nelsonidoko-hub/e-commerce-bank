import BillingPayment from '../models/BillingPayment.js'
import Store from '../models/Store.js'
import {
  startCheckout,
  confirmCheckout,
  applyPayment,
  billingSummary,
  BillingError,
  platformKey,
  isPaidNowFor,
} from '../utils/billing.js'
import { signatureMatches } from '../utils/paystackConfig.js'
import { forgetStore } from '../middleware/storeMiddleware.js'

function fail(res, error, where) {
  if (error instanceof BillingError) return res.status(400).json({ message: error.message })
  const paystack = error.response?.data?.message
  console.error(`${where} error:`, paystack || error.message)
  res.status(paystack ? 502 : 500).json({ message: paystack || 'Something went wrong. Please try again.' })
}

// Fresh from the database (req.store may be up to 30 seconds old)
const freshStore = (req) => Store.findById(req.store._id)

// GET /api/billing  (admin)
export const getBilling = async (req, res) => {
  try {
    const store = await freshStore(req)
    const history = await BillingPayment.find({ store: store._id, status: { $ne: 'pending' } })
      .sort({ createdAt: -1 })
      .limit(24)
      .lean()
    res.json({
      ...billingSummary(store),
      history: history.map((p) => ({
        reference: p.reference,
        kind: p.kind,
        plan: p.plan,
        amount: p.amount,
        status: p.status,
        failureReason: p.failureReason,
        date: p.paidAt || p.createdAt,
        periodEnd: p.periodEnd,
      })),
    })
  } catch (error) {
    fail(res, error, 'getBilling')
  }
}

// POST /api/billing/checkout  { plan }  (admin): a Paystack checkout link
export const checkout = async (req, res) => {
  try {
    const store = await freshStore(req)
    const result = await startCheckout(store, req.body?.plan, req.user.email)
    res.json(result)
  } catch (error) {
    fail(res, error, 'billingCheckout')
  }
}

// POST /api/billing/confirm  { reference }  (admin): back from Paystack
export const confirm = async (req, res) => {
  try {
    const reference = typeof req.body?.reference === 'string' ? req.body.reference.slice(0, 100) : ''
    if (!reference) return res.status(400).json({ message: 'Missing payment reference' })
    const result = await confirmCheckout(req.store, reference)
    if (!result.ok) return res.status(400).json({ message: "That payment didn't go through. You haven't been charged for it." })
    res.json({ paid: true, ...billingSummary(await freshStore(req)) })
  } catch (error) {
    fail(res, error, 'billingConfirm')
  }
}

// POST /api/billing/plan  { plan }  (admin)
//  - not paid yet (draft, trial, paused): switch freely; you'll pay for it when you subscribe
//  - paid, Pro → Basic: happens at the next renewal (you keep Pro until then)
//  - paid, choosing the plan you're on: cancels a waiting downgrade
//  - paid, Basic → Pro: use checkout (you pay the difference)
export const changePlan = async (req, res) => {
  try {
    const plan = req.body?.plan
    if (!['basic', 'pro'].includes(plan)) return res.status(400).json({ message: 'Choose Basic or Pro' })
    const store = await freshStore(req)
    const paid = isPaidNowFor(store)

    if (!paid) {
      store.plan = plan
      store.billing.nextPlan = null
    } else if (plan === store.plan) {
      store.billing.nextPlan = null
    } else if (plan === 'basic') {
      store.billing.nextPlan = 'basic'
    } else {
      return res.status(400).json({ message: 'Upgrading to Pro is paid now. Use "Upgrade" to pay the difference.' })
    }
    await store.save()
    forgetStore(store)
    res.json(billingSummary(store))
  } catch (error) {
    fail(res, error, 'changePlan')
  }
}

// POST /api/billing/auto-renew  { on }  (admin)
export const setAutoRenew = async (req, res) => {
  try {
    const store = await freshStore(req)
    store.billing.autoRenew = Boolean(req.body?.on)
    if (store.billing.autoRenew) store.billing.lastAttemptAt = null // allow a prompt retry
    await store.save()
    forgetStore(store)
    res.json(billingSummary(store))
  } catch (error) {
    fail(res, error, 'setAutoRenew')
  }
}

// POST /api/billing/webhook  (Paystack → platform)
// Set this address in the PLATFORM's Paystack dashboard. Signed with the
// platform key; shop orders have their own per-shop webhook instead.
export const billingWebhook = async (req, res) => {
  try {
    const key = platformKey()
    if (!key || !signatureMatches(req.rawBody, req.headers['x-paystack-signature'], key)) return res.sendStatus(401)
    const event = req.body
    if (event?.event === 'charge.success' && event.data?.metadata?.kind === 'subscription' && event.data.reference) {
      await applyPayment(String(event.data.reference), event.data)
    }
    res.sendStatus(200)
  } catch (error) {
    console.error('Billing webhook error:', error.message)
    res.sendStatus(500)
  }
}
