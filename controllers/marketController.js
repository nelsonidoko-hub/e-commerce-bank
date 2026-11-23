import mongoose from 'mongoose'
import Store from '../models/Store.js'
import Product from '../models/Product.js'
import MarketClick from '../models/MarketClick.js'
import MarketReport from '../models/MarketReport.js'
import { MARKET_CATEGORIES, isMarketCategory, cleanCity, marketStatus, listedStores } from '../utils/market.js'
import { storeUrl } from '../utils/storeUrl.js'
import { forgetStore } from '../middleware/storeMiddleware.js'

// The Market Square. Public routes read only public product details from
// shops that opted in; nothing about orders or customers ever leaves a shop.

const PAGE = 24
const DAY = 24 * 60 * 60 * 1000
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const today = (now = new Date()) => now.toISOString().slice(0, 10)

function serverError(res, error, where) {
  console.error(`${where}:`, error)
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
}

const soldOut = (p) => Array.isArray(p.sizes) && p.sizes.length > 0 && p.sizes.every((s) => !(s.stock > 0))

function card(p, store) {
  return {
    _id: p._id,
    name: p.name,
    price: p.price,
    oldPrice: p.onSale && p.oldPrice > p.price ? p.oldPrice : null,
    image: p.image,
    soldOut: soldOut(p),
    url: storeUrl(store, `/product/${p._id}`),
    shop: { _id: store._id, name: store.name, city: store.market?.city || '', url: storeUrl(store, '/') },
  }
}

// GET /api/market/meta -> categories and cities that have shops in them
export const marketMeta = async (req, res) => {
  try {
    const stores = await listedStores()
    const cities = {}
    const categories = {}
    for (const s of stores) {
      categories[s.market.category] = (categories[s.market.category] || 0) + 1
      if (s.market.city) cities[s.market.city] = (cities[s.market.city] || 0) + 1
    }
    res.json({
      shops: stores.length,
      categories: MARKET_CATEGORIES.map((c) => ({ ...c, shops: categories[c.id] || 0 })),
      cities: Object.entries(cities).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, shops]) => ({ name, shops })),
    })
  } catch (error) {
    serverError(res, error, 'marketMeta')
  }
}

// GET /api/market/products?q=&category=&city=&min=&max=&sort=newest|price-asc|price-desc&page=
export const marketProducts = async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : ''
    const category = typeof req.query.category === 'string' ? req.query.category : ''
    const city = typeof req.query.city === 'string' ? cleanCity(req.query.city) : ''
    const min = Number(req.query.min)
    const max = Number(req.query.max)
    const sort = { 'price-asc': { price: 1, _id: 1 }, 'price-desc': { price: -1, _id: 1 } }[req.query.sort] || { createdAt: -1, _id: 1 }
    const page = Math.min(Math.max(1, Math.floor(Number(req.query.page)) || 1), 200)

    let stores = await listedStores()
    if (isMarketCategory(category)) stores = stores.filter((s) => s.market.category === category)
    if (city) stores = stores.filter((s) => s.market.city === city)
    if (!stores.length) return res.json({ products: [], total: 0, page, pages: 0 })

    const byId = new Map(stores.map((s) => [String(s._id), s]))
    const inShops = { $in: stores.map((s) => s._id) }
    const filter = {
      isSample: { $ne: true },
      image: { $nin: ['', null] },
      price: { $gt: 0 },
    }
    if (Number.isFinite(min) && min > 0) filter.price.$gte = min
    if (Number.isFinite(max) && max > 0) filter.price.$lte = max
    if (q) {
      const re = { $regex: escapeRegex(q), $options: 'i' }
      filter.$or = [{ name: re }, { category: re }]
    }

    const [total, products] = await Promise.all([
      Product.countDocuments({ store: inShops, ...filter }),
      Product.find({ store: inShops, ...filter }).sort(sort).skip((page - 1) * PAGE).limit(PAGE).select('name price oldPrice onSale image sizes store createdAt').lean(),
    ])
    res.json({
      products: products.map((p) => card(p, byId.get(String(p.store)))),
      total,
      page,
      pages: Math.ceil(total / PAGE),
    })
  } catch (error) {
    serverError(res, error, 'marketProducts')
  }
}

// Find a product that is in the market right now (for clicks and reports)
async function listedProduct(productId) {
  if (!mongoose.isValidObjectId(productId)) return null
  const stores = await listedStores()
  if (!stores.length) return null
  const product = await Product.findOne({ _id: productId, store: { $in: stores.map((s) => s._id) }, isSample: { $ne: true } })
    .select('name store')
    .lean()
  if (!product) return null
  return { product, store: stores.find((s) => String(s._id) === String(product.store)) }
}

// POST /api/market/click { productId } -> counts a visit for the merchant
export const marketClick = async (req, res) => {
  try {
    const found = await listedProduct(req.body?.productId)
    if (!found) return res.status(404).json({ message: 'Not in the market' })
    await MarketClick.updateOne({ store: found.store._id, day: today() }, { $inc: { count: 1 } }, { upsert: true })
    res.json({ ok: true })
  } catch (error) {
    if (error?.code === 11000) return res.json({ ok: true })
    serverError(res, error, 'marketClick')
  }
}

const REASONS = ['fake', 'scam', 'offensive', 'wrong-info', 'other']

// POST /api/market/report { productId, reason, details }
export const marketReport = async (req, res) => {
  try {
    const reason = req.body?.reason
    if (!REASONS.includes(reason)) return res.status(400).json({ message: 'Choose a reason' })
    const found = await listedProduct(req.body?.productId)
    if (!found) return res.status(404).json({ message: 'Not in the market' })
    await MarketReport.create({
      store: found.store._id,
      storeName: found.store.name,
      product: found.product._id,
      productName: found.product.name,
      reason,
      details: typeof req.body.details === 'string' ? req.body.details.trim().slice(0, 500) : '',
    })
    res.status(201).json({ message: "Thanks. We'll take a look." })
  } catch (error) {
    serverError(res, error, 'marketReport')
  }
}

// ---------- the shop's own settings (shop admin) ----------

async function settingsView(store) {
  const since = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10)
  const clicks = await MarketClick.find({ store: store._id, day: { $gte: since } }).lean()
  const status = marketStatus(store)
  const products = status.shown
    ? await Product.countDocuments({ store: store._id, isSample: { $ne: true }, image: { $nin: ['', null] }, price: { $gt: 0 } })
    : 0
  return {
    listed: Boolean(store.market?.listed),
    category: store.market?.category || '',
    city: store.market?.city || '',
    shown: status.shown,
    reason: status.reason,
    needsPro: Boolean(status.needsPro),
    productsShown: products,
    visits30: clicks.reduce((n, c) => n + (c.count || 0), 0),
    categories: MARKET_CATEGORIES,
  }
}

// GET /api/market-settings
export const getMarketSettings = async (req, res) => {
  try {
    res.json(await settingsView(await Store.findById(req.store._id).lean()))
  } catch (error) {
    serverError(res, error, 'getMarketSettings')
  }
}

// PUT /api/market-settings { listed, category, city }
export const saveMarketSettings = async (req, res) => {
  try {
    const store = await Store.findById(req.store._id)
    const body = req.body || {}
    if (body.category !== undefined && body.category !== '' && !isMarketCategory(body.category)) {
      return res.status(400).json({ message: 'Choose a category from the list' })
    }
    const category = body.category !== undefined ? body.category : store.market?.category || ''
    const listed = body.listed !== undefined ? body.listed === true : Boolean(store.market?.listed)
    if (listed && !category) return res.status(400).json({ message: 'Choose a category for your shop first' })
    store.market = {
      ...(store.market?.toObject?.() || store.market || {}),
      listed,
      category,
      city: body.city !== undefined ? cleanCity(body.city) : store.market?.city || '',
    }
    await store.save()
    forgetStore(store)
    res.json(await settingsView(store.toObject()))
  } catch (error) {
    serverError(res, error, 'saveMarketSettings')
  }
}
