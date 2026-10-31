import Settings from '../models/Settings.js'

const TOP_LEVEL_FIELDS = ['storeName', 'contactEmail', 'contactPhone', 'whatsappNumber']

// Only these nested fields can be changed through the API
const SECTION_FIELDS = {
  address: ['line1', 'city', 'state', 'country'],
  social: ['instagram', 'x', 'tiktok'],
  shipping: ['flatRate', 'freeShippingThreshold'],
  tax: ['rate', 'label'],
  pickup: ['enabled', 'name', 'address', 'readyTime'],
  announcement: ['enabled', 'text', 'link'],
}

const NUMBER_FIELDS = new Set(['shipping.flatRate', 'shipping.freeShippingThreshold', 'tax.rate'])
const BOOLEAN_FIELDS = new Set(['pickup.enabled', 'announcement.enabled'])

// Always returns the one settings document, creating it with defaults the first time.
// Used by the order controller so shipping and tax are decided on the server.
export async function getStoreSettings() {
  return Settings.findOneAndUpdate(
    { key: 'store' },
    { $setOnInsert: { key: 'store' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  )
}

// Public: nothing in here is secret, and the storefront needs it
export const getSettings = async (req, res) => {
  try {
    const settings = await getStoreSettings()
    res.json(settings)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const updateSettings = async (req, res) => {
  try {
    const settings = await getStoreSettings()

    for (const field of TOP_LEVEL_FIELDS) {
      if (req.body[field] !== undefined) {
        settings[field] = String(req.body[field]).trim()
      }
    }

    for (const [section, fields] of Object.entries(SECTION_FIELDS)) {
      const incoming = req.body[section]
      if (!incoming || typeof incoming !== 'object') continue

      for (const field of fields) {
        if (incoming[field] === undefined) continue
        const path = `${section}.${field}`
        let value = incoming[field]

        if (NUMBER_FIELDS.has(path)) {
          value = Number(value)
          if (Number.isNaN(value) || value < 0) {
            return res.status(400).json({ message: `${field} must be a number, 0 or higher` })
          }
          if (path === 'tax.rate' && value > 100) {
            return res.status(400).json({ message: 'Tax rate cannot be more than 100%' })
          }
        } else if (BOOLEAN_FIELDS.has(path)) {
          value = Boolean(value)
        } else {
          value = String(value).trim()
        }

        settings[section][field] = value
      }
    }

    const saved = await settings.save()
    res.json(saved)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}