import Store, { SLUG_PATTERN, RESERVED_SLUGS } from '../models/Store.js'
import Product from '../models/Product.js'
import Category from '../models/Category.js'
import HeroSlide from '../models/HeroSlide.js'
import { getStoreSettings } from '../controllers/settingsController.js'
import { sampleContent } from './sampleData.js'
import { freshTemplates, isSelectableTemplate, sampleSetFor } from './templates.js'
import { trialDays } from './plans.js'
import { forgetStore } from '../middleware/storeMiddleware.js'

// ---------- shop addresses ----------

// "Mama's Kitchen & Grill!" -> "mamas-kitchen-grill"
export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/g, '')
}

// Why an address can't be used, or '' if it is fine (not counting "taken")
export function slugProblem(slug) {
  if (!slug) return 'Choose an address for your shop'
  if (slug.length < 3) return 'Use at least 3 letters or numbers'
  if (slug.length > 40) return 'Use 40 characters or fewer'
  if (!SLUG_PATTERN.test(slug) || slug.includes('--')) return 'Use only letters, numbers and single dashes, not at the start or end'
  if (RESERVED_SLUGS.includes(slug) || slug.startsWith('demo-')) return 'That address is reserved. Try another.'
  return ''
}

// Is it free? If not, a close alternative that is.
export async function checkSlug(raw) {
  const slug = String(raw || '').trim().toLowerCase()
  const problem = slugProblem(slug)
  if (problem) return { slug, available: false, reason: problem }
  if (!(await Store.exists({ slug }))) return { slug, available: true }

  for (let n = 2; n < 50; n++) {
    const candidate = `${slug.slice(0, 37)}-${n}`
    if (!(await Store.exists({ slug: candidate }))) {
      return { slug, available: false, reason: 'That address is taken', suggestion: candidate }
    }
  }
  return { slug, available: false, reason: 'That address is taken' }
}

// ---------- creating a shop ----------

const DAY = 24 * 60 * 60 * 1000

// Makes a shop for `owner` (a merchant account), already wearing `template`
// and filled with sample products, so it never opens empty.
//   publish:   go live now with the free trial (otherwise a draft)
//   samples:   add starter products, categories and banner (default yes)
//   isDemo:    a platform template demo (always open, refuses real orders)
//   design:    a saved template { theme, homeSections } to start from
export async function createShop({ owner, name, slug, template = 'classic', plan = 'basic', publish = false, samples = true, isDemo = false, notifyEmail, design = null }) {
  const shopName = String(name || '').trim().slice(0, 80)
  if (!shopName) throw new ShopError('Give your shop a name')
  const cleanSlug = String(slug || slugify(shopName)).trim().toLowerCase()
  const problem = isDemo ? '' : slugProblem(cleanSlug)
  if (problem) throw new ShopError(problem)
  await freshTemplates()
  if (!isSelectableTemplate(template)) throw new ShopError('Unknown template')

  const now = new Date()
  let store
  try {
    store = await Store.create({
      name: shopName,
      slug: cleanSlug,
      owner: owner._id,
      notifyEmail: notifyEmail || owner.email,
      plan,
      isDemo,
      publishedAt: publish || isDemo ? now : null,
      trialEndsAt: publish && !isDemo ? new Date(now.getTime() + trialDays() * DAY) : null,
      // demos stay open for good, outside billing
      currentPeriodEnd: isDemo ? new Date(now.getTime() + 100 * 365 * DAY) : null,
    })
  } catch (error) {
    if (error.code === 11000) throw new ShopError('That address is taken')
    throw error
  }

  try {
    const settings = await getStoreSettings(store)
    settings.theme.template = template

    if (samples) {
      const content = sampleContent(sampleSetFor(template), shopName)
      for (const [section, values] of Object.entries(content.settings)) {
        for (const [field, value] of Object.entries(values)) settings[section][field] = value
      }
      for (const category of content.categories) await Category.create({ ...category, store: store._id })
      for (const product of content.products) await Product.create({ ...product, store: store._id })
      await HeroSlide.create({ ...content.slide, store: store._id })
    }
    // Starting from one of the merchant's own saved templates
    if (design) {
      for (const [field, value] of Object.entries(design.theme || {})) settings.theme[field] = value
      if (Array.isArray(design.homeSections) && design.homeSections.length) {
        settings.homeSections = design.homeSections
        settings.markModified?.('homeSections')
      }
    }
    await settings.save()
  } catch (error) {
    // Don't leave a half-made shop behind
    for (const model of [Product, Category, HeroSlide]) await model.deleteMany({ store: store._id }).catch(() => {})
    await Store.deleteOne({ _id: store._id }).catch(() => {})
    throw error
  }

  forgetStore(store)
  return store
}

// Errors that are safe to show the merchant as-is
export class ShopError extends Error {}
