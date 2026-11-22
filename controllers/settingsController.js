import Settings from '../models/Settings.js'

const TOP_LEVEL_FIELDS = ['storeName', 'contactEmail', 'contactPhone', 'whatsappNumber']

const HOURS_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

// Only these nested fields can be changed through the API
const SECTION_FIELDS = {
  address: ['line1', 'city', 'state', 'country'],
  social: ['instagram', 'x', 'tiktok'],
  shipping: ['flatRate', 'freeShippingThreshold'],
  tax: ['rate', 'label'],
  pickup: ['enabled', 'name', 'address', 'readyTime'],
  announcement: ['enabled', 'text', 'link'],
  theme: ['template', 'brandColor', 'headingFont', 'bodyFont', 'radius'],
  hours: [
    'enabled',
    'timezone',
    'whenClosed',
    ...HOURS_DAYS.flatMap((day) => [`${day}Open`, `${day}Close`, `${day}Closed`]),
  ],
  homeArrivals: ['enabled', 'title', 'subtitle', 'count'],
  homeBestSellers: ['enabled', 'label', 'title'],
  homeBanner: ['enabled', 'image', 'heading', 'text', 'buttonLabel', 'buttonLink'],
  homeCategoryRow: ['enabled', 'title', 'category'],
  homeFeatured: ['enabled', 'title', 'image', 'buttonLabel', 'buttonLink', 'category'],
}

// Allowed values for the storefront theme. Keep these in step with utils/themes.js
// in the frontend when a template or font is added.
const THEME_TEMPLATES = ['classic', 'minimal', 'bold', 'fresh']
const THEME_HEADING_FONTS = ['poppins', 'epilogue', 'anton', 'playfair']
const THEME_BODY_FONTS = ['epilogue', 'poppins']
const THEME_RADIUS = ['square', 'soft', 'round']

// Returns a message if the value is not allowed, or null if it is fine.
// An empty string means "no override", so it is always allowed for the optional ones.
const VALIDATORS = {
  'theme.template': (v) => (THEME_TEMPLATES.includes(v) ? null : 'That template does not exist'),
  'theme.brandColor': (v) =>
    v === '' || /^#[0-9a-fA-F]{6}$/.test(v) ? null : 'The brand colour must look like #1a73e8',
  'theme.headingFont': (v) =>
    v === '' || THEME_HEADING_FONTS.includes(v) ? null : 'That heading font is not available',
  'theme.bodyFont': (v) =>
    v === '' || THEME_BODY_FONTS.includes(v) ? null : 'That body font is not available',
  'theme.radius': (v) =>
    v === '' || THEME_RADIUS.includes(v) ? null : 'Choose square, soft or rounded corners',
}

// Opening hours: a real time zone, a known closed-shop rule, and times like 09:00
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
VALIDATORS['hours.timezone'] = (v) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v })
    return null
  } catch {
    return 'That time zone is not recognised'
  }
}
VALIDATORS['hours.whenClosed'] = (v) =>
  ['block', 'preorder'].includes(v) ? null : 'Choose whether to block orders or allow pre-orders'
for (const day of HOURS_DAYS) {
  const timeCheck = (v) => (TIME_PATTERN.test(v) ? null : 'Times must look like 09:00 or 21:30')
  VALIDATORS[`hours.${day}Open`] = timeCheck
  VALIDATORS[`hours.${day}Close`] = timeCheck
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
  'hours.enabled',
  ...HOURS_DAYS.map((day) => `hours.${day}Closed`),
])

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

        const problem = VALIDATORS[path] ? VALIDATORS[path](value) : null
        if (problem) {
          return res.status(400).json({ message: problem })
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