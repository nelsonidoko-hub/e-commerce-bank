import mongoose from 'mongoose'

const str = (def = '') => ({ type: String, default: def, trim: true })

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