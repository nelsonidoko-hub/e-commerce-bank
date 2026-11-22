import mongoose from 'mongoose'

const str = (def = '') => ({ type: String, default: def, trim: true })

// monOpen, monClose, monClosed ... for each day of the week
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const dayFields = Object.fromEntries(
  DAYS.flatMap((day) => [
    [`${day}Open`, str('09:00')],
    [`${day}Close`, str('21:00')],
    [`${day}Closed`, { type: Boolean, default: false }],
  ])
)

const settingsSchema = new mongoose.Schema(
  {
    // Fixed key so there is only ever one settings document
    key: { type: String, default: 'store', unique: true },

    storeName: str('Abuja Store'),
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

    pickup: {
      enabled: { type: Boolean, default: true },
      name: str('Main Retail Store'),
      address: str(),
      readyTime: str('Usually ready in 2 to 4 hours'),
    },

    // Opening hours (Admin → Settings). Off by default.
    //   whenClosed: 'block' = no orders while closed, 'preorder' = orders allowed and flagged
    hours: {
      enabled: { type: Boolean, default: false },
      timezone: str('Africa/Lagos'),
      whenClosed: str('block'),
      ...dayFields,
    },

    // Storefront look (Admin → Themes). An empty override means "use the template's own".
    theme: {
      template: str('classic'),
      brandColor: str(),
      headingFont: str(),
      bodyFont: str(),
      radius: str(),
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
      title: str('Best Shoes'),
      category: str('shoes'), // category slug whose products fill the row
    },
    homeFeatured: {
      enabled: { type: Boolean, default: true },
      title: str('ZERO TO THE WORLD'),
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
  },
  { timestamps: true }
)

const Settings = mongoose.model('Settings', settingsSchema)
export default Settings