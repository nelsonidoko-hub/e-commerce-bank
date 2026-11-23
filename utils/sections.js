import crypto from 'crypto'

// The homepage is an ordered list of sections the merchant adds, removes,
// reorders and edits in the builder:
//   { id, type, enabled, data: { ...fields for that type } }
// Everything is checked here, so whatever the browser sends, only known
// section types and safe values are ever saved.

export const MAX_SECTIONS = 20

const text = (max) => ({ kind: 'text', max })
const choice = (values) => ({ kind: 'enum', values, default: values[0] })
const LINK = { kind: 'link' }
const IMAGE = { kind: 'image' }
const CATEGORY = { kind: 'category' }

export const SECTION_TYPES = {
  // The slides themselves are managed under Admin → Hero Banner
  hero: { label: 'Banner slideshow', single: true, fields: {} },
  products: {
    label: 'Products',
    fields: {
      title: text(120),
      subtitle: text(300),
      source: choice(['newest', 'bestsellers', 'category']),
      category: CATEGORY,
      count: { kind: 'int', min: 1, max: 24, default: 8 },
      layout: choice(['grid', 'carousel']),
    },
  },
  banner: {
    label: 'Promo banner',
    fields: { image: IMAGE, heading: text(120), text: text(300), buttonLabel: text(40), buttonLink: LINK },
  },
  featured: {
    label: 'Featured collection',
    fields: { title: text(120), image: IMAGE, buttonLabel: text(40), buttonLink: LINK, category: CATEGORY },
  },
  text: { label: 'Text', fields: { heading: text(120), text: text(2000), align: choice(['center', 'left']) } },
  imageText: {
    label: 'Image with text',
    fields: {
      image: IMAGE,
      heading: text(120),
      text: text(1000),
      buttonLabel: text(40),
      buttonLink: LINK,
      imageSide: choice(['left', 'right']),
    },
  },
  testimonials: {
    label: 'Testimonials',
    fields: { title: text(120), items: { kind: 'list', max: 6, of: { quote: text(400), name: text(60) } } },
  },
  // Uses the WhatsApp number from Admin → Settings
  whatsapp: { label: 'WhatsApp chat', fields: { heading: text(120), text: text(300), buttonLabel: text(40) } },
}

export class SectionError extends Error {}

const ID = /^[a-z0-9-]{4,30}$/
const newId = () => crypto.randomBytes(4).toString('hex')

// '' | a page of this shop ("/shop", "/category/shoes") | a full https link
export function safeLink(value) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return ''
  if (v.length > 300 || /\s/.test(v)) return null
  if (v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\')) return v
  try {
    const url = new URL(v)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

// '' | an uploaded picture (https) | one of the generated sample pictures
export function safeImage(value) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return ''
  if (v.startsWith('data:image/svg+xml')) return v.length <= 30000 ? v : null
  if (v.length > 1000) return null
  try {
    const url = new URL(v)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function cleanField(spec, value, where) {
  switch (spec.kind) {
    case 'text': {
      const v = typeof value === 'string' ? value.trim() : ''
      if (v.length > spec.max) throw new SectionError(`${where} is too long (${spec.max} characters at most)`)
      return v
    }
    case 'enum':
      return spec.values.includes(value) ? value : spec.default
    case 'int': {
      const n = Math.round(Number(value))
      if (!Number.isFinite(n)) return spec.default
      return Math.min(spec.max, Math.max(spec.min, n))
    }
    case 'category': {
      const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
      return /^[a-z0-9][a-z0-9 -]{0,59}$/.test(v) ? v : ''
    }
    case 'link': {
      const v = safeLink(value)
      if (v === null) throw new SectionError(`${where}: use a page of your shop (like /shop) or a full https:// link`)
      return v
    }
    case 'image': {
      const v = safeImage(value)
      if (v === null) throw new SectionError(`${where}: that picture address isn't valid`)
      return v
    }
    case 'list': {
      const list = Array.isArray(value) ? value : []
      if (list.length > spec.max) throw new SectionError(`${where}: ${spec.max} items at most`)
      return list.map((item, i) =>
        Object.fromEntries(Object.entries(spec.of).map(([k, s]) => [k, cleanField(s, item?.[k], `${where} item ${i + 1}`)]))
      )
    }
    default:
      throw new Error(`Unknown field kind ${spec.kind}`)
  }
}

// Checks a whole homepage. Throws SectionError with a sentence for the merchant.
export function cleanSections(input) {
  if (!Array.isArray(input)) throw new SectionError('Sections must be a list')
  if (input.length > MAX_SECTIONS) throw new SectionError(`A homepage can have up to ${MAX_SECTIONS} sections`)

  const seen = new Set()
  const out = []
  for (const raw of input) {
    const type = raw?.type
    const def = SECTION_TYPES[type]
    if (!def) throw new SectionError('Unknown section type')
    if (def.single && out.some((s) => s.type === type)) throw new SectionError(`Only one ${def.label} section is allowed`)

    let id = typeof raw.id === 'string' && ID.test(raw.id) && !seen.has(raw.id) ? raw.id : newId()
    while (seen.has(id)) id = newId()
    seen.add(id)

    const label = def.label
    const data = Object.fromEntries(
      Object.entries(def.fields).map(([field, spec]) => [field, cleanField(spec, raw.data?.[field], `${label} › ${field}`)])
    )
    out.push({ id, type, enabled: raw.enabled !== false, data })
  }
  return out
}

// Shops made before the builder kept their homepage as fixed blocks
// (homeArrivals, homeBestSellers ...). This turns them into the same sections,
// in the same order, so nothing changes for them.
export function sectionsFromLegacy(s = {}) {
  const a = s.homeArrivals || {}
  const b = s.homeBestSellers || {}
  const banner = s.homeBanner || {}
  const row = s.homeCategoryRow || {}
  const f = s.homeFeatured || {}
  const on = (block) => block.enabled !== false

  return [
    { id: 'hero', type: 'hero', enabled: true, data: {} },
    {
      id: 'new-arrivals',
      type: 'products',
      enabled: on(a),
      data: { title: a.title ?? 'New Arrivals', subtitle: a.subtitle ?? '', source: 'newest', category: '', count: Number(a.count) || 8, layout: 'grid' },
    },
    {
      id: 'best-sellers',
      type: 'products',
      enabled: on(b),
      data: { title: b.title ?? 'Best Sellers', subtitle: b.label ?? '', source: 'bestsellers', category: '', count: 12, layout: 'carousel' },
    },
    {
      id: 'promo-banner',
      type: 'banner',
      enabled: on(banner),
      data: {
        image: banner.image || '',
        heading: banner.heading || '',
        text: banner.text || '',
        buttonLabel: banner.buttonLabel || '',
        buttonLink: banner.buttonLink || '',
      },
    },
    {
      id: 'category-row',
      type: 'products',
      enabled: on(row) && Boolean(row.category),
      data: { title: row.title || '', subtitle: '', source: 'category', category: row.category || '', count: 12, layout: 'carousel' },
    },
    {
      id: 'featured',
      type: 'featured',
      enabled: on(f),
      data: { title: f.title || '', image: f.image || '', buttonLabel: f.buttonLabel || '', buttonLink: f.buttonLink || '', category: f.category || '' },
    },
  ]
}

// The homepage as customers see it right now
export function liveSections(settings) {
  const saved = settings?.homeSections
  return Array.isArray(saved) && saved.length ? saved : sectionsFromLegacy(settings)
}
