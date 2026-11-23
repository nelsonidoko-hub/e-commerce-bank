import Store from '../models/Store.js'
import { storeState } from './storeAccess.js'

// The Market Square: one public page where shoppers search products from every
// shop that opted in. Shoppers buy in the merchant's own shop, so the platform
// never handles their money.
//
// Render setting:
//   MARKET_PLANS   which plans can be listed, comma separated (default "basic,pro").
//                  Set to "pro" to make the market a Pro feature.

export const MARKET_CATEGORIES = [
  { id: 'fashion', label: 'Fashion & clothing' },
  { id: 'shoes-bags', label: 'Shoes & bags' },
  { id: 'beauty', label: 'Beauty & hair' },
  { id: 'food', label: 'Food & drinks' },
  { id: 'electronics', label: 'Phones & electronics' },
  { id: 'home', label: 'Home & kitchen' },
  { id: 'kids', label: 'Babies & kids' },
  { id: 'health', label: 'Health & fitness' },
  { id: 'art-gifts', label: 'Art, crafts & gifts' },
  { id: 'other', label: 'Other' },
]
const CATEGORY_IDS = new Set(MARKET_CATEGORIES.map((c) => c.id))
export const isMarketCategory = (id) => CATEGORY_IDS.has(id)

const warned = { plans: false }
export function marketPlans() {
  const raw = String(process.env.MARKET_PLANS ?? '').trim()
  if (!raw) return ['basic', 'pro']
  const plans = raw.toLowerCase().split(/[\s,]+/).filter((p) => p === 'basic' || p === 'pro')
  if (!plans.length) {
    if (!warned.plans) console.warn(`Market: MARKET_PLANS="${raw}" names no plan. Using basic,pro.`)
    warned.plans = true
    return ['basic', 'pro']
  }
  return [...new Set(plans)]
}

// "abuja " / "ABUJA" -> "Abuja", so the city filter groups them together
export function cleanCity(city) {
  return String(city || '')
    .replace(/[^\p{L}\p{N} .'-]/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 40)
    .toLowerCase()
    .replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase())
}

// Can this shop appear in the market right now? If not, a reason for the merchant.
export function marketStatus(store, now = new Date()) {
  const m = store?.market || {}
  if (store?.isDemo) return { shown: false, reason: 'Demo shops are not listed.' }
  if (m.hidden) return { shown: false, reason: `Hidden by the platform: ${m.hiddenReason || 'see support'}` }
  if (!marketPlans().includes(store.plan)) return { shown: false, reason: 'The Market Square is part of the Pro plan.', needsPro: true }
  const { state, live } = storeState(store, now)
  if (!live) {
    const why = { draft: 'Publish your shop first.', paused: 'Your shop is paused. Pay to reopen it.', suspended: 'Your shop is suspended.' }
    return { shown: false, reason: why[state] || 'Your shop is not live.' }
  }
  if (!m.listed) return { shown: false, reason: 'Switched off.' }
  if (!isMarketCategory(m.category)) return { shown: false, reason: 'Choose a category for your shop.' }
  return { shown: true, reason: '' }
}

// Every shop listed right now (lean, public fields only)
export async function listedStores(now = new Date()) {
  const stores = await Store.find({
    'market.listed': true,
    'market.hidden': { $ne: true },
    isDemo: { $ne: true },
    suspended: { $ne: true },
    publishedAt: { $ne: null },
    plan: { $in: marketPlans() },
  })
    .select('name slug plan market publishedAt trialEndsAt currentPeriodEnd suspended isDemo customDomain customDomainVerified')
    .lean()
  return stores.filter((s) => marketStatus(s, now).shown)
}
