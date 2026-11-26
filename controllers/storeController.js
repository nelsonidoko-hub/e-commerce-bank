import Store from '../models/Store.js'
import Product from '../models/Product.js'
import Category from '../models/Category.js'
import HeroSlide from '../models/HeroSlide.js'
import Logo from '../models/Logo.js'
import { planFor, publicPlans, trialDays, graceDays } from '../utils/plans.js'
import { getStoreSettings } from './settingsController.js'
import { resolvePaystack } from '../utils/paystackConfig.js'
import { forgetStore } from '../middleware/storeMiddleware.js'
import { inStore } from '../utils/tenant.js'
import { canManageStore } from '../utils/storeAccess.js'
import { storeUrl, webhookUrl } from '../utils/storeUrl.js'
import { unmarkSample } from '../utils/sampleData.js'

// GET /api/store/status
// Everyone: the shop's name and whether it is open.
// The people who run it also see their plan, trial and billing dates.
// Works even while the shop is offline, so the owner can see why.
export const getStoreStatus = async (req, res) => {
  const store = req.store
  const access = req.storeAccess

  const body = {
    name: store.name,
    slug: store.slug,
    live: access.live,
    // Visitors only learn "open" or "not open", never billing details
    state: access.live ? 'open' : access.state === 'suspended' ? 'unavailable' : 'offline',
    poweredBy: planFor(store).poweredBy,
    // Template demos show a "start your shop with this template" bar
    isDemo: Boolean(store.isDemo),
    demoTemplate: store.isDemo ? store.slug.replace(/^demo-/, '') : null,
  }

  if (req.user && canManageStore(req.user, store)) {
    body.manage = {
      state: access.state, // draft | trial | active | grace | paused | suspended
      until: access.until || null,
      plan: store.plan,
      planDetails: { ...planFor(store), productLimit: Number.isFinite(planFor(store).productLimit) ? planFor(store).productLimit : null },
      plans: publicPlans(),
      trialDays: trialDays(),
      graceDays: graceDays(),
      publishedAt: store.publishedAt,
      trialEndsAt: store.trialEndsAt,
      currentPeriodEnd: store.currentPeriodEnd,
      url: storeUrl(store),
      webhookUrl: webhookUrl(store),
      suspendedReason: access.state === 'suspended' ? store.suspendedReason : '',
    }
  }

  res.json(body)
}

const DAY = 24 * 60 * 60 * 1000

// Bank transfer (with full bank details) or pay on delivery is switched on
const manualPayReady = (settings) => {
  const bt = settings.bankTransfer || {}
  return Boolean((bt.enabled && bt.bankName && bt.accountNumber && bt.accountName) || settings.payOnDelivery?.enabled)
}

// What's done and what's left before the shop can go live
async function setupStatus(req) {
  const store = req.store
  const [settings, ownProducts, sampleProducts, logo, paystack] = await Promise.all([
    getStoreSettings(store),
    Product.countDocuments(inStore(req, { isSample: { $ne: true } })),
    Product.countDocuments(inStore(req, { isSample: true })),
    Logo.findOne(inStore(req, { name: 'main' })).select('_id').lean(),
    resolvePaystack(store._id),
  ])

  const steps = [
    { id: 'logo', label: 'Add your logo', done: Boolean(logo), link: '/admin/logo' },
    { id: 'products', label: 'Add your first product', done: ownProducts > 0, link: '/admin/products/new', required: true },
    { id: 'samples', label: 'Keep or remove the sample products', done: sampleProducts === 0, required: true },
    { id: 'contact', label: 'Add your phone number and delivery fee', done: Boolean(settings.contactPhone || settings.whatsappNumber), link: '/admin/settings' },
    // Any way for customers to pay: Paystack, or bank transfer / pay on
    // delivery (for vendors still waiting for Paystack activation)
    {
      id: 'payments',
      label: 'Set up how customers pay (Paystack, bank transfer or pay on delivery)',
      done: Boolean(paystack.secret) || manualPayReady(settings),
      link: paystack.secret ? '/admin/payments' : '/admin/settings',
      required: true,
    },
    { id: 'theme', label: 'Make the design yours', done: Boolean(settings.theme?.brandColor || settings.theme?.headingFont), link: '/admin/builder?tab=design' },
  ]
  const missing = steps.filter((s) => s.required && !s.done)

  return {
    steps,
    ownProducts,
    sampleProducts,
    published: Boolean(store.publishedAt),
    state: req.storeAccess.state,
    until: req.storeAccess.until || null,
    trialDays: trialDays(),
    canPublish: !store.publishedAt && missing.length === 0,
    blockers: missing.map((s) => s.label),
  }
}

// GET /api/store/setup  (admin)
export const getSetup = async (req, res) => {
  try {
    res.json(await setupStatus(req))
  } catch (error) {
    console.error('getSetup error:', error)
    res.status(500).json({ message: 'Something went wrong' })
  }
}

// POST /api/store/publish  (admin)
// Opens the shop to the public and starts the free trial (TRIAL_DAYS on the
// server). Needs a real product, no sample products left, and a way to be
// paid (Paystack, bank transfer or pay on delivery), so customers can never
// pay for something that doesn't exist.
export const publishStore = async (req, res) => {
  try {
    if (req.store.isDemo) return res.status(400).json({ message: 'Demo shops are managed by the platform' })
    const status = await setupStatus(req)
    if (status.published) return res.status(400).json({ message: 'Your shop is already published' })
    if (!status.canPublish) {
      return res.status(400).json({ message: `Before publishing: ${status.blockers.join(', ').toLowerCase()}.`, blockers: status.blockers })
    }

    const now = new Date()
    // Only set publishedAt if it is still empty, so two clicks can't restart the trial
    const result = await Store.updateOne(
      { _id: req.store._id, publishedAt: null },
      { $set: { publishedAt: now, trialEndsAt: req.store.trialEndsAt || new Date(now.getTime() + trialDays() * DAY) } }
    )
    forgetStore(req.store)
    if (result.modifiedCount === 0) return res.status(400).json({ message: 'Your shop is already published' })

    const store = await Store.findById(req.store._id).lean()
    res.json({ published: true, trialEndsAt: store.trialEndsAt })
  } catch (error) {
    console.error('publishStore error:', error)
    res.status(500).json({ message: 'Something went wrong' })
  }
}

// POST /api/store/samples/keep  (admin)
// The merchant keeps the template's products, categories, banner and pictures
// as their own (they really sell them, or will edit them later). They stop
// being samples: the "SAMPLE" mark leaves the drawn pictures, and they count
// as real products for publishing and the Market Square.
export const keepSamples = async (req, res) => {
  try {
    const products = await Product.find(inStore(req, { isSample: true }))
    for (const p of products) {
      p.isSample = false
      p.image = unmarkSample(p.image)
      if (p.hoverImage) p.hoverImage = unmarkSample(p.hoverImage)
      if (Array.isArray(p.images)) p.images = p.images.map(unmarkSample)
      await p.save()
    }
    await Category.updateMany(inStore(req, { isSample: true }), { $set: { isSample: false } })
    const slides = await HeroSlide.find(inStore(req, { isSample: true }))
    for (const slide of slides) {
      slide.isSample = false
      slide.mediaUrl = unmarkSample(slide.mediaUrl)
      await slide.save()
    }

    const settings = await getStoreSettings(req.store)
    for (const section of ['homeBanner', 'homeFeatured']) {
      if (settings[section]?.image) settings[section].image = unmarkSample(settings[section].image)
    }
    const unmarkSections = (list) => (Array.isArray(list) ? list.map((x) => (x?.data?.image ? { ...x, data: { ...x.data, image: unmarkSample(x.data.image) } } : x)) : list)
    if (Array.isArray(settings.homeSections)) {
      settings.homeSections = unmarkSections(settings.homeSections)
      settings.markModified('homeSections')
    }
    if (settings.draft?.homeSections) {
      settings.draft = { ...settings.draft, homeSections: unmarkSections(settings.draft.homeSections) }
      settings.markModified('draft')
    }
    await settings.save()

    res.json({ kept: { products: products.length }, setup: await setupStatus(req) })
  } catch (error) {
    console.error('keepSamples error:', error)
    res.status(500).json({ message: 'Something went wrong' })
  }
}

// DELETE /api/store/samples  (admin)
// Removes the starter products, starter categories nobody uses any more,
// the starter banner, and the sample homepage pictures.
export const removeSamples = async (req, res) => {
  try {
    const products = await Product.deleteMany(inStore(req, { isSample: true }))

    const used = new Set((await Product.find(inStore(req)).select('category').lean()).map((p) => p.category))
    const sampleCategories = await Category.find(inStore(req, { isSample: true })).lean()
    const unusedNames = sampleCategories.filter((c) => !used.has(c.name)).map((c) => c.name)
    // children first are not needed: starter categories have no parents
    const categories = await Category.deleteMany(inStore(req, { isSample: true, name: { $in: unusedNames } }))
    const slides = await HeroSlide.deleteMany(inStore(req, { isSample: true }))

    const settings = await getStoreSettings(req.store)
    for (const section of ['homeBanner', 'homeFeatured']) {
      if (String(settings[section]?.image || '').startsWith('data:image/svg+xml')) settings[section].image = ''
    }
    await settings.save()

    res.json({
      removed: { products: products.deletedCount, categories: categories.deletedCount, slides: slides.deletedCount },
      setup: await setupStatus(req),
    })
  } catch (error) {
    console.error('removeSamples error:', error)
    res.status(500).json({ message: 'Something went wrong' })
  }
}
