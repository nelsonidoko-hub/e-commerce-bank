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
  homeArrivals: ['enabled', 'title', 'subtitle', 'count'],
  homeBestSellers: ['enabled', 'label', 'title'],
  homeBanner: ['enabled', 'image', 'heading', 'text', 'buttonLabel', 'buttonLink'],
  homeCategoryRow: ['enabled', 'title', 'category'],
  homeFeatured: ['enabled', 'title', 'image', 'buttonLabel', 'buttonLink', 'category'],
}

const NUMBER_FIELDS = new Set([
  'shipping.flatRate',
  'shipping.freeShippingThreshold',
  'tax.rate',
  'homeArrivals.count',
])
const BOOLEAN_FIELDS = new Set([
  'pickup.enabled',
  'announcement.enabled',
  'homeArrivals.enabled',
  'homeBestSellers.enabled',
  'homeBanner.enabled',
  'homeCategoryRow.enabled',
  'homeFeatured.enabled',
])

// ---------- theme and opening hours: stricter checks ----------
// These must match frontend utils/themes.js. Empty string = "use the template's own".
const TEMPLATES = ['classic', 'minimal', 'bold', 'fresh', 'catalog', 'glow', 'tech', 'playful']
const HEADING_FONTS = ['poppins', 'epilogue', 'anton', 'playfair']
const BODY_FONTS = ['epilogue', 'poppins']
const RADII = ['square', 'soft', 'round']
const HEX = /^#[0-9a-f]{6}$/i
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

// Throws a message the admin can read; returns the clean values to save
export function cleanTheme(input) {
  const out = {}
  const pick = (field, allowed, label) => {
    if (input[field] === undefined) return
    const value = String(input[field]).trim().toLowerCase()
    if (value !== '' && !allowed.includes(value)) throw new Error(`Unknown ${label}`)
    out[field] = value
  }

  if (input.template !== undefined) {
    const t = String(input.template).trim().toLowerCase()
    if (!TEMPLATES.includes(t)) throw new Error('Unknown template')
    out.template = t
  }
  pick('headingFont', HEADING_FONTS, 'heading font')
  pick('bodyFont', BODY_FONTS, 'text font')
  pick('radius', RADII, 'corner style')

  if (input.brandColor !== undefined) {
    const c = String(input.brandColor).trim().toLowerCase()
    if (c !== '' && !HEX.test(c)) throw new Error('Brand colour must look like #1a2b3c')
    out.brandColor = c
  }
  return out
}

export function cleanHours(input) {
  const out = {}
  if (input.enabled !== undefined) out.enabled = Boolean(input.enabled)

  if (input.timezone !== undefined) {
    const tz = String(input.timezone).trim()
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
    } catch {
      throw new Error('Unknown time zone')
    }
    out.timezone = tz
  }

  if (input.whenClosed !== undefined) {
    if (!['block', 'preorder'].includes(input.whenClosed)) {
      throw new Error('"When closed" must be block or preorder')
    }
    out.whenClosed = input.whenClosed
  }

  for (const day of DAYS) {
    for (const part of ['Open', 'Close']) {
      const key = `${day}${part}`
      if (input[key] === undefined) continue
      const value = String(input[key]).trim()
      if (!TIME.test(value)) throw new Error(`${key} must be a time like 09:00`)
      out[key] = value
    }
    if (input[`${day}Closed`] !== undefined) out[`${day}Closed`] = Boolean(input[`${day}Closed`])
  }
  return out
}

// Always returns the shop's settings document, creating it with defaults the
// first time (named after the shop). Used by the order controller so shipping
// and tax are decided on the server.
// store: the shop (req.store), or its id
export async function getStoreSettings(store) {
  const storeId = store?._id || store
  if (!storeId) throw new Error('getStoreSettings needs a store')
  return Settings.findOneAndUpdate(
    { store: storeId },
    { $setOnInsert: { storeName: store?.name || 'My Store' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  )
}

// Public: nothing in here is secret, and the storefront needs it
export const getSettings = async (req, res) => {
  try {
    const settings = await getStoreSettings(req.store)
    res.json(settings)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const updateSettings = async (req, res) => {
  try {
    const settings = await getStoreSettings(req.store)

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
          if (path === 'homeArrivals.count') {
            value = Math.round(value)
            if (value < 1 || value > 24) {
              return res
                .status(400)
                .json({ message: 'Number of new arrivals must be between 1 and 24' })
            }
          }
        } else if (BOOLEAN_FIELDS.has(path)) {
          value = Boolean(value)
        } else {
          value = String(value).trim()
        }

        settings[section][field] = value
      }
    }

    // Theme and hours have their own, stricter rules
    const special = { theme: cleanTheme, hours: cleanHours }
    for (const [section, clean] of Object.entries(special)) {
      const incoming = req.body[section]
      if (!incoming || typeof incoming !== 'object') continue
      let values
      try {
        values = clean(incoming)
      } catch (err) {
        return res.status(400).json({ message: err.message })
      }
      for (const [field, value] of Object.entries(values)) settings[section][field] = value
    }

    const saved = await settings.save()
    res.json(saved)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}