import Page from '../models/Page.js'
import { inStore, byId, upsertSafely } from '../utils/tenant.js'
import { DEFAULT_PAGES } from '../utils/defaultPages.js'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// Addresses the store already uses, so a page can never hide a real route
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'all', 'login', 'register', 'shop', 'cart', 'checkout',
  'orders', 'search', 'category', 'product', 'payment-success',
])

// Adds the starter pages the first time, and only when there are none at all,
// so a page the owner deleted on purpose never comes back.
// Upserting by slug makes this safe even if two requests arrive together.
// Each shop gets its own copy.
async function ensureDefaultPages(req) {
  const count = await Page.countDocuments(inStore(req))
  if (count > 0) return

  for (const page of DEFAULT_PAGES) {
    // Two requests can arrive together for a new shop (footer + page)
    await upsertSafely(() =>
      Page.findOneAndUpdate(
        inStore(req, { slug: page.slug }),
        // slug comes from the filter on insert, so it isn't repeated here
        { $setOnInsert: (({ slug, ...rest }) => rest)(page) },
        { upsert: true, setDefaultsOnInsert: true }
      )
    )
  }
}

// Checks what the admin form sent and returns clean data to save
function cleanFields(body, requireAll) {
  const data = {}

  if (requireAll || body.title !== undefined) {
    const title = String(body.title || '').trim()
    if (!title) return { error: 'Give the page a title' }
    if (title.length > 120) return { error: 'The title is too long' }
    data.title = title
  }

  if (requireAll || body.slug !== undefined) {
    const slug = String(body.slug || '').trim().toLowerCase()
    if (!SLUG_PATTERN.test(slug) || slug.length > 60) {
      return { error: 'The web address can only use letters, numbers and single dashes' }
    }
    if (RESERVED_SLUGS.has(slug)) {
      return { error: `"${slug}" is already used by the store. Choose a different address.` }
    }
    data.slug = slug
  }

  if (body.content !== undefined) {
    const content = String(body.content)
    if (content.length > 50000) return { error: 'The page text is too long' }
    data.content = content
  }

  if (body.footerColumn !== undefined) {
    if (!['resources', 'support', 'none'].includes(body.footerColumn)) {
      return { error: 'Choose where the footer link should go' }
    }
    data.footerColumn = body.footerColumn
  }

  if (body.published !== undefined) data.published = Boolean(body.published)

  if (body.order !== undefined) {
    const order = Number(body.order || 0)
    if (Number.isNaN(order)) return { error: 'Position must be a number' }
    data.order = order
  }

  return { data }
}

// Public: only what the footer needs, for published pages
export const getPublicPages = async (req, res) => {
  try {
    await ensureDefaultPages(req)
    const pages = await Page.find(inStore(req, { published: true }))
      .select('slug title footerColumn order')
      .sort({ order: 1, title: 1 })
    res.json(pages)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

// Public: one published page, with its text
export const getPageBySlug = async (req, res) => {
  try {
    await ensureDefaultPages(req)
    const page = await Page.findOne(inStore(req, { slug: String(req.params.slug).toLowerCase(), published: true }))
    if (!page) return res.status(404).json({ message: 'Page not found' })
    res.json(page)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

// Admin: everything, including hidden pages
export const getAllPages = async (req, res) => {
  try {
    await ensureDefaultPages(req)
    const pages = await Page.find(inStore(req)).sort({ footerColumn: 1, order: 1, title: 1 })
    res.json(pages)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const createPage = async (req, res) => {
  try {
    const { data, error } = cleanFields(req.body, true)
    if (error) return res.status(400).json({ message: error })

    const page = await Page.create({ ...data, store: req.store._id })
    res.status(201).json(page)
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A page with that web address already exists' })
    }
    res.status(400).json({ message: error.message })
  }
}

export const updatePage = async (req, res) => {
  try {
    const page = await Page.findOne(byId(req))
    if (!page) return res.status(404).json({ message: 'Page not found' })

    const { data, error } = cleanFields(req.body, false)
    if (error) return res.status(400).json({ message: error })

    Object.assign(page, data)
    const updated = await page.save()
    res.json(updated)
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A page with that web address already exists' })
    }
    res.status(400).json({ message: error.message })
  }
}

export const deletePage = async (req, res) => {
  try {
    const page = await Page.findOne(byId(req))
    if (!page) return res.status(404).json({ message: 'Page not found' })

    await Page.deleteOne(byId(req, page._id))
    res.json({ message: 'Page removed' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}