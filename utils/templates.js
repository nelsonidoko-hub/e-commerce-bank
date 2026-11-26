import StudioTemplate from '../models/StudioTemplate.js'
import { SAMPLE_PRODUCT_NAMES } from './sampleData.js'

// Every template a shop can wear: the 8 built into the code, plus the ones
// made in the Template Studio (stored in the database as a "recipe").
// Lookups here are instant (kept in memory) and refreshed whenever the Studio
// changes something, and at least every minute.

export const BUILTIN_TEMPLATES = ['classic', 'minimal', 'bold', 'fresh', 'catalog', 'glow', 'tech', 'playful', 'gadget', 'atelier']

// The parts a recipe is made of. These must match frontend utils/themes.js.
export const PARTS = {
  headingFont: ['poppins', 'epilogue', 'anton', 'playfair'],
  bodyFont: ['epilogue', 'poppins'],
  radius: ['square', 'soft', 'round'],
  headingWeight: [0, 400, 500, 600, 700, 800],
  card: ['standard', 'borderless', 'bordered', 'menu', 'compact', 'centered', 'spec', 'tile'],
  grid: ['grid', 'list'],
  columns: [2, 3, 4, 5],
  footer: ['dark', 'light'],
  hero: ['full', 'compact', 'slim', 'split', 'none'],
  // The rest of the shop (frontend utils/themes.js LAYOUT_CHOICES)
  rows: ['grid', 'slider', 'spotlight', 'shelf'],
  categories: ['none', 'tiles', 'circles', 'chips', 'banners'],
  quotes: ['cards', 'single', 'plain'],
  product: ['classic', 'wide', 'sticky', 'simple'],
  listing: ['standard', 'sidebar', 'chips', 'large'],
  density: ['compact', 'normal', 'airy'],
}
const STRUCTURE_LABELS = {
  rows: 'product row style',
  categories: 'category strip',
  quotes: 'reviews style',
  product: 'product page',
  listing: 'shop page layout',
  density: 'spacing',
}
// Which starter products a new shop gets (the built-in sets in sampleData.js)
export const SAMPLE_SETS = {
  classic: 'Everyday clothing',
  minimal: 'Fashion and boutique',
  bold: 'Streetwear and sneakers',
  fresh: 'Food and restaurant menu',
  catalog: 'Big general store (home and kitchen)',
  glow: 'Beauty and skincare',
  tech: 'Phones and gadgets',
  playful: 'Babies and kids',
  custom: 'My own products (type them in)',
}

export class TemplateError extends Error {}
const isHex = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
const KEY = /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/

export function cleanKey(key) {
  const k = String(key || '').trim().toLowerCase()
  if (!KEY.test(k)) throw new TemplateError('The short name must be 3-30 letters, numbers or dashes, starting with a letter')
  if (BUILTIN_TEMPLATES.includes(k)) throw new TemplateError('That name belongs to a built-in template')
  return k
}

// Checks every part. Unknown or bad values are refused, so a recipe can
// never break a storefront.
export function cleanRecipe(input) {
  const r = input && typeof input === 'object' ? input : {}
  const l = r.layout && typeof r.layout === 'object' ? r.layout : {}
  const one = (value, allowed, label) => {
    if (!allowed.includes(value)) throw new TemplateError(`Choose a valid ${label}`)
    return value
  }
  const colour = (value, label, optional) => {
    if (optional && (value === '' || value === undefined || value === null)) return ''
    if (!isHex(value)) throw new TemplateError(`${label} must be a colour like #1a2b3c`)
    return value.toLowerCase()
  }
  return {
    brand: colour(r.brand, 'Accent colour'),
    ink: colour(r.ink, 'Text colour', true),
    surface: colour(r.surface, 'Background colour', true),
    headingFont: one(r.headingFont, PARTS.headingFont, 'heading font'),
    bodyFont: one(r.bodyFont, PARTS.bodyFont, 'body font'),
    radius: one(r.radius, PARTS.radius, 'corner style'),
    uppercase: r.uppercase === true,
    headingWeight: one(Number(r.headingWeight) || 0, PARTS.headingWeight, 'heading weight'),
    layout: {
      card: one(l.card, PARTS.card, 'product card style'),
      grid: one(l.grid, PARTS.grid, 'product layout'),
      columns: one(Number(l.columns), PARTS.columns, 'number of columns'),
      footer: one(l.footer, PARTS.footer, 'footer style'),
      hero: one(l.hero, PARTS.hero, 'banner style'),
      search: l.search === true,
      // Menu bar and homepage: built-in styles or a template pack's part
      // (frontend storefront/parts.js). Unknown ids show the standard one.
      nav: partId(l.nav, 'standard'),
      home: partId(l.home, 'sections'),
      // Left out when not given: the storefront then uses the built-in's own
      // structure (an edited built-in) or the standard one
      ...structure(l, one),
    },
  }
}
function structure(l, one) {
  const out = {}
  for (const [key, label] of Object.entries(STRUCTURE_LABELS)) {
    if (l[key] !== undefined && l[key] !== null && l[key] !== '') out[key] = one(l[key], PARTS[key], label)
  }
  for (const key of ['bands', 'dividers']) if (typeof l[key] === 'boolean') out[key] = l[key]
  return out
}
const partId = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(value)) throw new TemplateError('Choose a valid page structure')
  return value
}

// Real photos: only web addresses (https), only for known picture slots and
// the sample products of the chosen set
const photoUrl = (value) => {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return ''
  try {
    const url = new URL(v)
    if (url.protocol !== 'https:' || v.length > 600) throw new Error()
    return url.href
  } catch {
    throw new TemplateError("A picture address isn't valid. Upload the picture again.")
  }
}
export function cleanPictures(input, sampleSet) {
  const p = input && typeof input === 'object' ? input : {}
  const out = { hero: photoUrl(p.hero), banner: photoUrl(p.banner), featured: photoUrl(p.featured), products: {} }
  const names = SAMPLE_PRODUCT_NAMES[sampleSet] || []
  for (const [name, url] of Object.entries(p.products && typeof p.products === 'object' ? p.products : {})) {
    if (names.includes(name) && photoUrl(url)) out.products[name] = photoUrl(url)
  }
  return out
}

// "My own products": the template's own categories (they become the shop's
// menu), products, prices and photos
export function cleanSamples(input) {
  const s = input && typeof input === 'object' ? input : {}
  const line = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
  const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  const categories = []
  for (const c of Array.isArray(s.categories) ? s.categories.slice(0, 8) : []) {
    const label = line(c?.label, 30)
    const name = slug(label)
    if (label && name && !categories.some((x) => x.name === name)) categories.push({ name, label })
  }
  if (!categories.length) throw new TemplateError('Add at least one category (it becomes the shop menu)')
  const products = []
  for (const p of Array.isArray(s.products) ? s.products.slice(0, 12) : []) {
    const name = line(p?.name, 60)
    if (!name) continue
    if (products.some((x) => x.name === name)) throw new TemplateError(`Two products are called "${name}"`)
    const price = Math.round(Number(p.price))
    if (!Number.isFinite(price) || price < 0 || price > 100000000) throw new TemplateError(`Give "${name}" a price`)
    const category = categories.find((c) => c.name === slug(line(p.category, 40)) || c.label === line(p.category, 30))?.name || categories[0].name
    products.push({ name, price, category, description: line(p.description, 200), image: photoUrl(p.image) })
  }
  if (!products.length) throw new TemplateError('Add at least one product')
  return { heading: line(s.heading, 60), text: line(s.text, 120), categories, products }
}

// Who a private template is for: up to 50 emails
export function cleanEmails(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/)
  const out = []
  for (const raw of list) {
    const e = String(raw || '').trim().toLowerCase()
    if (!e) continue
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) throw new TemplateError(`"${e}" isn't a valid email`)
    if (!out.includes(e)) out.push(e)
  }
  if (out.length > 50) throw new TemplateError('Up to 50 emails per private template')
  return out
}

// ---------- the in-memory copy of Studio templates ----------
let cache = new Map() // key -> new Studio templates { key, label, status, recipe, sampleSet, pictures }
let edits = new Map() // built-in id -> its published edited version
let loadedAt = 0
const MAX_AGE = 60 * 1000

export async function refreshTemplates() {
  const all = await StudioTemplate.find({}).select('key label bestFor description status recipe sampleSet pictures builtIn samples visibility allowedEmails').lean()
  cache = new Map(all.filter((t) => !t.builtIn).map((t) => [t.key, t]))
  edits = new Map(all.filter((t) => t.builtIn && t.status === 'published').map((t) => [t.builtIn, t]))
  loadedAt = Date.now()
  return cache
}
// For async code paths: makes sure the copy is no older than a minute
export async function freshTemplates() {
  if (Date.now() - loadedAt > MAX_AGE) await refreshTemplates()
  return cache
}
export function forgetTemplates() {
  cache = new Map()
  edits = new Map()
  loadedAt = 0
}

const isBuiltIn = (id) => BUILTIN_TEMPLATES.includes(id)
const studio = (id) => cache.get(id)
export const studioStatus = (id) => studio(id)?.status || ''
// Can a merchant choose this template now? (built-in, or published in the Studio)
export const isSelectableTemplate = (id) => isBuiltIn(id) || studio(id)?.status === 'published'
// Private templates (made for particular clients)
const isPrivate = (id) => studio(id)?.visibility === 'private'
// In the gallery and on demo shops: built-in, or published and public
export const isPublicTemplate = (id) => isSelectableTemplate(id) && !isPrivate(id)
// Can this platform account (email) start a shop with it, or switch to it?
export const canUseTemplate = (id, email) => {
  if (!isSelectableTemplate(id)) return false
  if (!isPrivate(id)) return true
  return Boolean(email) && (studio(id).allowedEmails || []).includes(String(email).toLowerCase())
}
// Does it exist at all? (shops keep a hidden template they already use)
export const isKnownTemplate = (id) => isBuiltIn(id) || cache.has(id)
// The recipe a storefront needs: a Studio template's, or a built-in's edited
// version. null = use the look in the frontend code.
export const recipeFor = (id) => (isBuiltIn(id) ? edits.get(id)?.recipe || null : studio(id)?.recipe || null)
// Which starter products to use
export const sampleSetFor = (id) => {
  const t = isBuiltIn(id) ? edits.get(id) : studio(id)
  if (t && SAMPLE_SETS[t.sampleSet] && (t.sampleSet !== 'custom' || t.samples?.products?.length)) return t.sampleSet
  return isBuiltIn(id) ? id : 'classic'
}
// The template's own products ("My own products"), or null
export const samplesFor = (id) => {
  const t = isBuiltIn(id) ? edits.get(id) : studio(id)
  return t?.sampleSet === 'custom' ? t.samples || null : null
}
// Real photos for new shops (null = drawn pictures)
export const picturesFor = (id) => (isBuiltIn(id) ? edits.get(id)?.pictures : studio(id)?.pictures) || null

// For the gallery: new published templates, plus edited built-ins (builtIn set)
export const publishedStudioTemplates = () => {
  const card = (t, id) => ({ id, label: t.label, bestFor: t.bestFor, description: t.description, sampleSet: t.sampleSet, recipe: t.recipe, pictures: t.pictures || {}, samples: t.sampleSet === 'custom' ? t.samples : null })
  return [
    ...[...edits.values()].map((t) => ({ ...card(t, t.builtIn), builtIn: t.builtIn })),
    ...[...cache.values()].filter((t) => t.status === 'published' && t.visibility !== 'private').map((t) => card(t, t.key)),
  ]
}
