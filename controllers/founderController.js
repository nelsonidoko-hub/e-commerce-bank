import crypto from 'crypto'
import mongoose from 'mongoose'
import Store from '../models/Store.js'
import User from '../models/User.js'
import Product from '../models/Product.js'
import Order from '../models/Order.js'
import BillingPayment from '../models/BillingPayment.js'
import PlatformAction from '../models/PlatformAction.js'
import MarketReport from '../models/MarketReport.js'
import { marketStatus } from '../utils/market.js'
import { storeState } from '../utils/storeAccess.js'
import { getPlans } from '../utils/plans.js'
import { storeUrl } from '../utils/storeUrl.js'
import { addMonth, nextPeriodStart } from '../utils/billing.js'
import { forgetStore } from '../middleware/storeMiddleware.js'

// The founder dashboard: the whole platform at a glance, and the few things
// only the platform owner may do to a shop. Superadmin accounts only; every
// change is written to the action log.

const DAY = 24 * 60 * 60 * 1000
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function serverError(res, error, where) {
  console.error(`${where} error:`, error)
  res.status(500).json({ message: 'Something went wrong' })
}

// After platformProtect: only the platform owner
export const superadminOnly = (req, res, next) => {
  if (req.user?.role !== 'superadmin' || req.user.store) return res.status(403).json({ message: 'Founder access only' })
  next()
}

const monthStart = (d, offset = 0) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))

function row(store, owner, now) {
  const access = storeState(store, now)
  return {
    _id: store._id,
    name: store.name,
    slug: store.slug,
    url: storeUrl(store),
    ownerName: owner?.name || '',
    ownerEmail: owner?.email || '',
    plan: store.plan,
    state: access.state,
    until: access.until || null,
    suspendedReason: store.suspendedReason || '',
    customDomain: store.customDomainVerified ? store.customDomain : '',
    createdAt: store.createdAt,
  }
}

async function ownersOf(stores) {
  const ids = [...new Set(stores.map((s) => String(s.owner)))]
  const owners = await User.find({ _id: { $in: ids } }).select('name email').lean()
  return new Map(owners.map((o) => [String(o._id), o]))
}

// ---------- the team (Template Studio designers) ----------
const teamView = (u) => ({ _id: u._id, name: u.name, email: u.email, founder: u.role === 'superadmin', designer: Boolean(u.designer) })

// GET /api/founder/team
export const listTeam = async (req, res) => {
  try {
    const team = await User.find({ store: null, $or: [{ role: 'superadmin' }, { designer: true }] }).select('name email role designer').lean()
    res.json(team.map(teamView))
  } catch (error) {
    serverError(res, error, 'listTeam')
  }
}

// POST /api/founder/team { email }  -> that platform account can use the Studio
export const addDesigner = async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    const user = email ? await User.findOne({ store: null, email, role: { $in: ['merchant', 'superadmin'] } }) : null
    if (!user) return res.status(404).json({ message: 'No platform account with that email. Ask them to sign up first.' })
    await User.updateOne({ _id: user._id }, { $set: { designer: true } })
    res.json(teamView({ ...user.toObject(), designer: true }))
  } catch (error) {
    serverError(res, error, 'addDesigner')
  }
}

// DELETE /api/founder/team/:id
export const removeDesigner = async (req, res) => {
  try {
    const r = await User.updateOne({ _id: req.params.id, store: null }, { $set: { designer: false } }).catch(() => null)
    if (!r?.matchedCount) return res.status(404).json({ message: 'Not found' })
    res.json({ message: 'Removed from the team' })
  } catch (error) {
    serverError(res, error, 'removeDesigner')
  }
}

// GET /api/founder/overview
export const overview = async (req, res) => {
  try {
    const now = new Date()
    const plans = getPlans()
    const stores = await Store.find({ isDemo: { $ne: true } }).lean()
    const owners = await ownersOf(stores)

    const states = { draft: 0, trial: 0, active: 0, grace: 0, paused: 0, suspended: 0 }
    let mrr = 0
    const trialsEnding = []
    const overdue = []
    for (const s of stores) {
      const a = storeState(s, now)
      states[a.state] = (states[a.state] || 0) + 1
      if (a.state === 'active' || a.state === 'grace') mrr += plans[s.plan]?.price || 0
      if (a.state === 'trial' && a.until && a.until - now <= 3 * DAY) trialsEnding.push(row(s, owners.get(String(s.owner)), now))
      if (a.state === 'grace') overdue.push(row(s, owners.get(String(s.owner)), now))
    }

    const paid = (from, to) =>
      BillingPayment.find({ status: 'paid', kind: { $ne: 'gift' }, paidAt: { $gte: from, $lt: to } }).select('amount').lean()
    const [thisMonth, lastMonth, failed, recentPayments, recentActions] = await Promise.all([
      paid(monthStart(now), monthStart(now, 1)),
      paid(monthStart(now, -1), monthStart(now)),
      BillingPayment.find({ status: 'failed', createdAt: { $gte: new Date(now - 7 * DAY) } }).sort({ createdAt: -1 }).limit(20).lean(),
      BillingPayment.find({ status: 'paid' }).sort({ paidAt: -1 }).limit(10).lean(),
      PlatformAction.find({}).sort({ createdAt: -1 }).limit(15).lean(),
    ])
    const openReports = await MarketReport.find({ status: 'open' }).sort({ createdAt: -1 }).limit(10).lean()
    const sum = (list) => list.reduce((t, p) => t + (p.amount || 0), 0)
    const names = new Map(stores.map((s) => [String(s._id), s.name]))
    const withShop = (p) => ({ reference: p.reference, store: p.store, storeName: names.get(String(p.store)) || '', amount: p.amount, plan: p.plan, kind: p.kind, reason: p.failureReason, date: p.paidAt || p.createdAt })

    res.json({
      shops: stores.length,
      newThisWeek: stores.filter((s) => new Date(s.createdAt) >= new Date(now - 7 * DAY)).length,
      states,
      income: { thisMonth: sum(thisMonth), lastMonth: sum(lastMonth), monthlyRecurring: mrr },
      trialsEnding,
      overdue,
      failedPayments: failed.map(withShop),
      recentPayments: recentPayments.map(withShop),
      recentActions,
      market: {
        shops: stores.filter((s) => marketStatus(s, now).shown).length,
        openReports: openReports.map((r) => ({ _id: r._id, store: r.store, storeName: r.storeName, productName: r.productName, reason: r.reason, details: r.details, createdAt: r.createdAt })),
      },
    })
  } catch (error) {
    serverError(res, error, 'founderOverview')
  }
}

// GET /api/founder/shops?q=&state=&page=
export const listShops = async (req, res) => {
  try {
    const now = new Date()
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : ''
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1))
    const PER = 25

    const filter = { isDemo: { $ne: true } }
    if (q) {
      const re = { $regex: escapeRegex(q), $options: 'i' }
      const owners = await User.find({ store: null, $or: [{ email: re }, { name: re }] }).select('_id').lean()
      filter.$or = [{ name: re }, { slug: re }, { customDomain: re }, { owner: { $in: owners.map((o) => o._id) } }]
    }
    let stores = await Store.find(filter).sort({ createdAt: -1 }).lean()
    if (state) stores = stores.filter((s) => storeState(s, now).state === state)

    const total = stores.length
    const slice = stores.slice((page - 1) * PER, page * PER)
    const owners = await ownersOf(slice)
    const rows = await Promise.all(
      slice.map(async (s) => {
        const [products, lastOrder] = await Promise.all([
          Product.countDocuments({ store: s._id }),
          Order.findOne({ store: s._id }).sort({ createdAt: -1 }).select('createdAt').lean(),
        ])
        return { ...row(s, owners.get(String(s.owner)), now), products, lastOrderAt: lastOrder?.createdAt || null }
      })
    )
    res.json({ total, page, pages: Math.max(1, Math.ceil(total / PER)), shops: rows })
  } catch (error) {
    serverError(res, error, 'founderListShops')
  }
}

async function detail(storeId) {
  const now = new Date()
  const store = await Store.findById(storeId).lean()
  if (!store) return null
  const [owner, products, orders, paidOrders, payments, actions] = await Promise.all([
    User.findById(store.owner).select('name email createdAt').lean(),
    Product.countDocuments({ store: store._id }),
    Order.countDocuments({ store: store._id }),
    Order.countDocuments({ store: store._id, isPaid: true }),
    BillingPayment.find({ store: store._id, status: { $ne: 'pending' } }).sort({ createdAt: -1 }).limit(20).lean(),
    PlatformAction.find({ store: store._id }).sort({ createdAt: -1 }).limit(20).lean(),
  ])
  const reports = await MarketReport.find({ store: store._id }).sort({ createdAt: -1 }).limit(20).lean()
  return {
    ...row(store, owner, now),
    isDemo: Boolean(store.isDemo),
    publishedAt: store.publishedAt,
    trialEndsAt: store.trialEndsAt,
    currentPeriodEnd: store.currentPeriodEnd,
    autoRenew: store.billing?.autoRenew !== false,
    card: store.billing?.cardLast4 ? `${store.billing.cardBrand || 'card'} ${store.billing.cardLast4}` : '',
    domain: store.customDomain ? { name: store.customDomain, verified: Boolean(store.customDomainVerified), hosting: store.customDomainHosting || '' } : null,
    counts: { products, orders, paidOrders },
    payments: payments.map((p) => ({ reference: p.reference, kind: p.kind, plan: p.plan, amount: p.amount, status: p.status, reason: p.failureReason, date: p.paidAt || p.createdAt })),
    actions,
    market: {
      listed: Boolean(store.market?.listed),
      category: store.market?.category || '',
      city: store.market?.city || '',
      hidden: Boolean(store.market?.hidden),
      hiddenReason: store.market?.hiddenReason || '',
      shown: marketStatus(store, now).shown,
      reports: reports.map((r) => ({ _id: r._id, productName: r.productName, reason: r.reason, details: r.details, status: r.status, createdAt: r.createdAt })),
    },
  }
}

// GET /api/founder/shops/:id
export const getShop = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Shop not found' })
    const d = await detail(req.params.id)
    if (!d) return res.status(404).json({ message: 'Shop not found' })
    res.json(d)
  } catch (error) {
    serverError(res, error, 'founderGetShop')
  }
}

// POST /api/founder/shops/:id/action  { action, reason?, days?, months?, plan? }
//   suspend (reason) | unsuspend | extend-trial (days 1-60) | free-months (months 1-12) | plan (basic|pro)
export const shopAction = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Shop not found' })
    const store = await Store.findById(req.params.id)
    if (!store) return res.status(404).json({ message: 'Shop not found' })
    if (store.isDemo) return res.status(400).json({ message: 'Demo shops are managed with npm run seed-demos' })

    const body = req.body || {}
    const now = new Date()
    let details = ''

    switch (body.action) {
      case 'suspend': {
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : ''
        if (!reason) return res.status(400).json({ message: 'Give a reason (the merchant sees it)' })
        store.suspended = true
        store.suspendedReason = reason
        details = reason
        break
      }
      case 'unsuspend':
        store.suspended = false
        store.suspendedReason = ''
        break
      case 'extend-trial': {
        const days = Math.round(Number(body.days))
        if (!(days >= 1 && days <= 60)) return res.status(400).json({ message: 'Extend by 1 to 60 days' })
        if (!store.publishedAt) return res.status(400).json({ message: "This shop isn't published yet, so its trial hasn't started" })
        const from = Math.max(now.getTime(), store.trialEndsAt ? new Date(store.trialEndsAt).getTime() : 0)
        store.trialEndsAt = new Date(from + days * DAY)
        details = `+${days} days, now ends ${store.trialEndsAt.toISOString().slice(0, 10)}`
        break
      }
      case 'free-months': {
        const months = Math.round(Number(body.months))
        if (!(months >= 1 && months <= 12)) return res.status(400).json({ message: 'Give 1 to 12 months' })
        let end = nextPeriodStart(store, now)
        for (let i = 0; i < months; i++) end = addMonth(end)
        store.currentPeriodEnd = end
        await BillingPayment.create({
          store: store._id,
          reference: `gift_${crypto.randomBytes(9).toString('hex')}`,
          kind: 'gift',
          plan: store.plan,
          amount: 0,
          status: 'paid',
          paidAt: now,
          periodEnd: end,
        })
        details = `${months} free month${months === 1 ? '' : 's'}, paid until ${end.toISOString().slice(0, 10)}`
        break
      }
      case 'plan': {
        if (!['basic', 'pro'].includes(body.plan)) return res.status(400).json({ message: 'Choose Basic or Pro' })
        details = `${store.plan} → ${body.plan}`
        store.plan = body.plan
        store.billing.nextPlan = null
        break
      }
      case 'market-hide': {
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : ''
        if (!reason) return res.status(400).json({ message: 'Give a reason (the merchant sees it)' })
        store.market.hidden = true
        store.market.hiddenReason = reason
        details = reason
        break
      }
      case 'market-unhide':
        store.market.hidden = false
        store.market.hiddenReason = ''
        break
      case 'close-reports':
        await MarketReport.updateMany({ store: store._id, status: 'open' }, { $set: { status: 'closed' } })
        details = 'Market reports marked as dealt with'
        break
      default:
        return res.status(400).json({ message: 'Unknown action' })
    }

    await store.save()
    forgetStore(store)
    await PlatformAction.create({ by: req.user._id, byEmail: req.user.email, store: store._id, storeName: store.name, action: body.action, details })
    res.json(await detail(store._id))
  } catch (error) {
    serverError(res, error, 'founderShopAction')
  }
}
