import mongoose from 'mongoose'
import { tenantPlugin } from '../utils/tenant.js'

const str = (def = '') => ({ type: String, default: def, trim: true })

// monOpen, monClose, monClosed ... sunClosed
function dayFields() {
  const fields = {}
  for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    fields[`${day}Open`] = str('09:00')
    fields[`${day}Close`] = str('21:00')
    fields[`${day}Closed`] = { type: Boolean, default: false }
  }
  return fields
}

const settingsSchema = new mongoose.Schema(
  {
    // Fixed key so there is only ever one settings document

    storeName: str('My Store'),
    contactEmail: str(),
    contactPhone: str(),
    whatsappNumber: str(),

    address: {
      line1: str(),
      city: str(),
      state: str(),
      country: str('Nigeria'),
    },

    social: {
      instagram: str(),
      x: str(),
      tiktok: str(),
    },

    shipping: {
      // Charged on every delivery order
      flatRate: { type: Number, default: 3500, min: 0 },
      // Orders at or above this subtotal ship free. 0 = never free.
      freeShippingThreshold: { type: Number, default: 0, min: 0 },
    },

    tax: {
      // Percent of the subtotal, e.g. 7.5 for 7.5% VAT. 0 = no tax.
      rate: { type: Number, default: 7.5, min: 0, max: 100 },
      label: str('VAT'),
    },

    // Ways to pay besides Paystack (good for vendors still waiting for
    // Paystack activation). The merchant confirms these payments by hand.
    bankTransfer: {
      enabled: { type: Boolean, default: false },
      bankName: str(),
      accountNumber: str(),
      accountName: str(),
      note: str(),
      // Unpaid transfer orders are cancelled (and stock released) after this
      holdHours: { type: Number, default: 24, min: 1, max: 72 },
    },
    payOnDelivery: {
      enabled: { type: Boolean, default: false },
      note: str('Pay the rider by cash or transfer when your order arrives.'),
    },

    pickup: {
      enabled: { type: Boolean, default: true },
      name: str('Main Retail Store'),
      address: str(),
      readyTime: str('Usually ready in 2 to 4 hours'),
    },

    // Homepage sections (Admin → Homepage)
    homeArrivals: {
      enabled: { type: Boolean, default: true },
      title: str('New Arrivals'),
      subtitle: str('Explore the newest drops'),
      count: { type: Number, default: 8, min: 1, max: 24 },
    },
    homeBestSellers: {
      enabled: { type: Boolean, default: true },
      label: str('Trending'),
      title: str('Best Seller'),
    },
    homeBanner: {
      enabled: { type: Boolean, default: true },
      image: str(), // empty = use the built-in banner picture
      heading: str('New Season, New Style'),
      text: str('Check out our latest collection before it sells out'),
      buttonLabel: str('Shop Now'),
      buttonLink: str('/shop'),
    },
    homeCategoryRow: {
      enabled: { type: Boolean, default: true },
      title: str('Popular picks'),
      category: str(''), // category slug whose products fill the row
    },
    homeFeatured: {
      enabled: { type: Boolean, default: true },
      title: str('Featured collection'),
      image: str(), // empty = use the built-in picture
      buttonLabel: str('VIEW'),
      buttonLink: str('/shop'),
      category: str(), // empty = newest products
    },

    announcement: {
      enabled: { type: Boolean, default: false },
      text: str(),
      link: str(),
    },

    // Storefront look (Admin → Themes). Empty values mean "use the template's own".
    theme: {
      template: str('classic'),
      brandColor: str(),
      headingFont: str(),
      bodyFont: str(),
      radius: str(),
    },

    // Opening hours (Admin → Settings). Off by default, so the shop is always open.
    // The homepage, as an ordered list of sections (see utils/sections.js).
    // Empty for shops made before the builder: their old blocks above are
    // turned into sections when read.
    homeSections: { type: [mongoose.Schema.Types.Mixed], default: undefined },

    // Builder changes not published yet: { theme, homeSections, updatedAt }.
    // Customers never see it; the owner sees it in the builder's preview.
    draft: { type: mongoose.Schema.Types.Mixed, default: null },

    hours: {
      enabled: { type: Boolean, default: false },
      timezone: str('Africa/Lagos'),
      // 'block' = refuse orders while closed, 'preorder' = accept and flag them
      whenClosed: { type: String, enum: ['block', 'preorder'], default: 'block' },
      ...dayFields(),
    },
  },
  { timestamps: true }
)

// Belongs to one shop, and every query must say which (see utils/tenant.js)
settingsSchema.plugin(tenantPlugin, { storeIndex: false })
// Exactly one settings document per shop
settingsSchema.index({ store: 1 }, { unique: true })
const Settings = mongoose.model('Settings', settingsSchema)
export default Settings