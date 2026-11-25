import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import User from '../models/User.js'
import Store from '../models/Store.js'
import { createShop, checkSlug, slugify, ShopError } from '../utils/createShop.js'
import { publicPlans, trialDays, envNumber } from '../utils/plans.js'
import { storeState, canManageStore } from '../utils/storeAccess.js'
import { storeUrl } from '../utils/storeUrl.js'
import { cleanTheme } from './settingsController.js'
import { freshTemplates, isSelectableTemplate, isPublicTemplate, canUseTemplate, publishedStudioTemplates } from '../utils/templates.js'
import SavedDesign from '../models/SavedDesign.js'
import { cleanSections } from '../utils/sections.js'
import { sendPlatformPasswordReset } from '../utils/email.js'
import { cleanEmail, cleanName, validPassword, isString, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../utils/validate.js'

// Platform accounts. Shop customers, and accounts from the old single-store
// app that were never migrated, are not: they can't sign in or reset here.
const PLATFORM_ROLES = ['merchant', 'superadmin']

// The platform's own site (yourplatform.com): the template gallery, sign-up,
// and the merchant's list of shops. Nothing here belongs to one shop, so these
// routes run before the shop lookup (see app.js).

const PASSWORD_MESSAGE = `Password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters`
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)
const maxShops = () => Math.max(1, Math.min(envNumber('MAX_SHOPS_PER_MERCHANT'), 100))

function serverError(res, error, where) {
  console.error(`${where} error:`, error)
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
}

const platformToken = (user) =>
  jwt.sign({ id: user._id, scope: 'platform' }, process.env.JWT_SECRET, { expiresIn: '7d' })

const accountResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  designer: Boolean(user.designer),
  token: platformToken(user),
})

function shopSummary(store, user) {
  const access = storeState(store)
  return {
    _id: store._id,
    name: store.name,
    slug: store.slug,
    url: storeUrl(store),
    plan: store.plan,
    state: access.state,
    live: access.live,
    until: access.until || null,
    isOwner: String(store.owner) === String(user._id),
    createdAt: store.createdAt,
  }
}

// ---------- public ----------

export const getPlans = (req, res) => {
  res.json({ plans: publicPlans(), trialDays: trialDays() })
}

// The live demo shop for each template, for "View demo" in the gallery
export const getDemos = async (req, res) => {
  try {
    await freshTemplates()
    const demos = await Store.find({ isDemo: true, suspended: { $ne: true } }).select('slug name customDomain customDomainVerified').lean()
    res.json(
      demos
        .map((store) => ({ template: store.slug.replace(/^demo-/, ''), name: store.name, url: storeUrl(store) }))
        .filter((d) => isPublicTemplate(d.template))
    )
  } catch (error) {
    serverError(res, error, 'getDemos')
  }
}

// GET /api/platform/templates -> Template Studio templates in the gallery
// (the 8 built-in ones are in the frontend code)
export const getStudioGallery = async (req, res) => {
  try {
    await freshTemplates()
    res.json(publishedStudioTemplates())
  } catch (error) {
    serverError(res, error, 'getStudioGallery')
  }
}

// GET /api/platform/slug-check?slug=mamas-kitchen  (or ?name=Mama's Kitchen)
export const slugCheck = async (req, res) => {
  try {
    const raw = isString(req.query.slug) && req.query.slug ? req.query.slug : slugify(isString(req.query.name) ? req.query.name : '')
    res.json(await checkSlug(String(raw).slice(0, 60)))
  } catch (error) {
    serverError(res, error, 'slugCheck')
  }
}

// ---------- accounts ----------

// POST /api/platform/signup  { name, email, password, shopName, slug, template }
// Creates the merchant account and their first shop (a draft, already wearing
// the chosen template, with sample products), and signs them in.
export const signup = async (req, res) => {
  let user = null
  try {
    const name = cleanName(req.body.name)
    const email = cleanEmail(req.body.email)
    const { password } = req.body
    if (!name || !email) return res.status(400).json({ message: 'Enter your name and a valid email address' })
    if (!validPassword(password)) return res.status(400).json({ message: PASSWORD_MESSAGE })

    const shopName = isString(req.body.shopName) ? req.body.shopName.trim() : ''
    if (!shopName) return res.status(400).json({ message: 'Give your shop a name' })
    if (req.body.acceptTerms !== true) {
      return res.status(400).json({ message: 'Please accept the terms and the selling rules to continue', field: 'terms' })
    }
    await freshTemplates()
    const template = canUseTemplate(req.body.template, email) ? req.body.template : 'classic'

    const slug = isString(req.body.slug) && req.body.slug.trim() ? req.body.slug.trim().toLowerCase() : slugify(shopName)
    const check = await checkSlug(slug)
    if (!check.available) {
      return res.status(400).json({ message: check.reason, field: 'slug', suggestion: check.suggestion })
    }

    if (await User.exists({ store: null, email })) {
      return res.status(400).json({ message: 'You already have an account. Log in to add another shop.', code: 'ACCOUNT_EXISTS' })
    }

    user = await User.create({ store: null, role: 'merchant', name, email, password, termsAcceptedAt: new Date() })
    const store = await createShop({ owner: user, name: shopName, slug, template })

    res.status(201).json({ account: accountResponse(user), shop: shopSummary(store, user) })
  } catch (error) {
    // No account without its shop
    if (user) await User.deleteOne({ _id: user._id }).catch(() => {})
    if (error instanceof ShopError) return res.status(400).json({ message: error.message })
    if (error.code === 11000) return res.status(400).json({ message: 'That email or shop address was just taken. Please try again.' })
    serverError(res, error, 'signup')
  }
}

// POST /api/platform/login  { email, password }  (merchant accounts only)
export const login = async (req, res) => {
  try {
    const email = cleanEmail(req.body.email)
    if (!email || !isString(req.body.password)) {
      return res.status(400).json({ message: 'Enter your email and password' })
    }
    const user = await User.findOne({ store: null, email, role: { $in: PLATFORM_ROLES } })
    if (!user) {
      await bcrypt.compare(req.body.password, DUMMY_HASH)
      return res.status(401).json({ message: 'Invalid email or password' })
    }
    if (!(await user.matchPassword(req.body.password))) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }
    res.json(accountResponse(user))
  } catch (error) {
    serverError(res, error, 'platformLogin')
  }
}

// ---------- signed-in merchants ----------

// Only platform accounts (merchants and the platform owner)
export const platformProtect = async (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ message: 'Please log in' })
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET, { algorithms: ['HS256'] })
    const user = await User.findById(decoded.id).select('-password -resetToken -resetTokenExpires -loginCodeHash')
    if (!user || user.store) return res.status(401).json({ message: 'Please log in' })
    if (user.passwordChangedAt && decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      return res.status(401).json({ message: 'Please log in again' })
    }
    req.user = user
  } catch {
    return res.status(401).json({ message: 'Please log in' })
  }
  next()
}

async function myShops(user) {
  return Store.find({ isDemo: { $ne: true }, $or: [{ owner: user._id }, { staff: user._id }] })
    .sort({ createdAt: 1 })
    .lean()
}

// GET /api/platform/me
export const getMe = async (req, res) => {
  try {
    const shops = (await myShops(req.user)).filter((s) => canManageStore(req.user, s))
    res.json({
      account: { _id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role, designer: Boolean(req.user.designer) },
      shops: shops.map((s) => shopSummary(s, req.user)),
      maxShops: maxShops(),
    })
  } catch (error) {
    serverError(res, error, 'getMe')
  }
}

// POST /api/platform/shops  { shopName, slug, template }  (another shop)
export const createAnotherShop = async (req, res) => {
  try {
    const owned = await Store.countDocuments({ owner: req.user._id, isDemo: { $ne: true } })
    if (owned >= maxShops()) {
      return res.status(403).json({ message: `You can have up to ${maxShops()} shops. Contact us if you need more.` })
    }
    const shopName = isString(req.body.shopName) ? req.body.shopName.trim() : ''
    if (!shopName) return res.status(400).json({ message: 'Give your shop a name' })
    await freshTemplates()
    const template = canUseTemplate(req.body.template, req.user.email) ? req.body.template : 'classic'
    const slug = isString(req.body.slug) && req.body.slug.trim() ? req.body.slug.trim().toLowerCase() : slugify(shopName)
    const check = await checkSlug(slug)
    if (!check.available) return res.status(400).json({ message: check.reason, field: 'slug', suggestion: check.suggestion })

    // Optionally start from one of their own saved templates (Pro merchants)
    let design = null
    if (req.body.designId) {
      if (!mongoose.isValidObjectId(req.body.designId)) return res.status(404).json({ message: 'Template not found' })
      const saved = await SavedDesign.findOne({ _id: req.body.designId, owner: req.user._id }).lean()
      if (!saved) return res.status(404).json({ message: 'Template not found' })
      const hasPro = await Store.exists({ owner: req.user._id, plan: 'pro', isDemo: { $ne: true } })
      if (!hasPro) return res.status(403).json({ message: 'Starting from your own templates is part of the Pro plan.', code: 'PLAN_LIMIT' })
      design = { theme: cleanTheme(saved.theme || {}), homeSections: cleanSections(saved.homeSections || []) }
    }

    const store = await createShop({ owner: req.user, name: shopName, slug, template: design?.theme?.template || template, design })
    res.status(201).json({ shop: shopSummary(store, req.user) })
  } catch (error) {
    if (error instanceof ShopError) return res.status(400).json({ message: error.message })
    serverError(res, error, 'createAnotherShop')
  }
}

// POST /api/platform/shops/:id/admin-link
// A one-time link that signs the merchant straight into that shop's admin.
// The code works once, for 2 minutes, on that shop only.
export const adminLink = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Shop not found' })
    const store = await Store.findById(req.params.id).lean()
    if (!store || !canManageStore(req.user, store)) return res.status(404).json({ message: 'Shop not found' })

    const code = crypto.randomBytes(24).toString('base64url')
    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          loginCodeHash: crypto.createHash('sha256').update(code).digest('hex'),
          loginCodeExpires: new Date(Date.now() + 2 * 60 * 1000),
          loginCodeStore: store._id,
        },
      }
    )
    const next = req.body?.next === 'shop' ? 'shop' : 'admin'
    res.json({ url: storeUrl(store, `/admin/welcome?code=${code}&next=${next}`) })
  } catch (error) {
    serverError(res, error, 'adminLink')
  }
}

// GET /api/platform/designs: the merchant's own saved templates, for "New shop"
export const myDesigns = async (req, res) => {
  try {
    const designs = await SavedDesign.find({ owner: req.user._id }).sort({ createdAt: -1 }).lean()
    const hasPro = Boolean(await Store.exists({ owner: req.user._id, plan: 'pro', isDemo: { $ne: true } }))
    res.json({
      canUse: hasPro,
      designs: designs.map((d) => ({ _id: d._id, name: d.name, template: d.theme?.template || 'classic', fromStoreName: d.fromStoreName })),
    })
  } catch (error) {
    serverError(res, error, 'myDesigns')
  }
}

// ---------- forgot password (merchant accounts) ----------

// A page of the platform site, for links in emails
export function platformLink(path) {
  const domain = (process.env.PLATFORM_DOMAIN || '').trim().toLowerCase()
  if (domain) return `https://${domain}${path}`
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '')
  return `${base}${path}${path.includes('?') ? '&' : '?'}platform=1`
}

// Platform accounts. Shop customers (and old single-store accounts that were
// never migrated) are not, so they can't sign in or reset here.
// POST /api/platform/forgot-password  { email }
export const forgotPassword = async (req, res) => {
  try {
    const email = cleanEmail(req.body.email)
    if (!email) return res.status(400).json({ message: 'Enter a valid email address' })
    const user = await User.findOne({ store: null, email, role: { $in: PLATFORM_ROLES } })
    // Same answer either way, so this can't be used to find out who has an account
    if (user) {
      const raw = crypto.randomBytes(32).toString('hex')
      // Only these two fields change, so an older account with other odd
      // fields can't make the save fail
      await User.updateOne(
        { _id: user._id },
        { $set: { resetToken: crypto.createHash('sha256').update(raw).digest('hex'), resetTokenExpires: new Date(Date.now() + 30 * 60 * 1000) } }
      )
      sendPlatformPasswordReset(user, platformLink(`/reset-password/${raw}`)).catch((e) => console.error('Reset email error:', e.message))
    }
    res.json({ message: 'If that email has an account, a reset link has been sent.' })
  } catch (error) {
    serverError(res, error, 'platformForgotPassword')
  }
}

// POST /api/platform/reset-password  { token, password }
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body
    if (!isString(token) || !token || token.length > 200) return res.status(400).json({ message: 'This reset link is invalid or has expired' })
    if (!validPassword(password)) return res.status(400).json({ message: PASSWORD_MESSAGE })
    const user = await User.findOne({
      store: null,
      role: { $in: PLATFORM_ROLES },
      resetToken: crypto.createHash('sha256').update(token).digest('hex'),
      resetTokenExpires: { $gt: new Date() },
    })
    if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired' })
    // An account the founder made for a client: they agree to the terms here
    if (!user.termsAcceptedAt) {
      if (req.body.acceptTerms !== true) return res.status(400).json({ message: 'Please accept the Terms of Service to continue', field: 'terms' })
      user.termsAcceptedAt = new Date()
    }
    user.password = password
    user.resetToken = undefined
    user.resetTokenExpires = undefined
    await user.save() // also signs out older sessions
    res.json(accountResponse(user))
  } catch (error) {
    serverError(res, error, 'platformResetPassword')
  }
}
