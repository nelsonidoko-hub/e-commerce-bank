import jwt from 'jsonwebtoken'
import Store from '../models/Store.js'
import User from '../models/User.js'
import { storeState, canManageStore } from '../utils/storeAccess.js'

// Works out which shop a request is for, and puts it on req.store.
//
// The storefront runs on the shop's own address (amaka.yourplatform.com or
// amaka.com) but calls this API on a different one, so the browser tells us
// where it is with a header:
//   X-Store-Host   the page's hostname, e.g. "amaka.yourplatform.com"
//   X-Store-Slug   the shop's slug directly; used while developing on
//                  localhost or a Vercel preview, where the hostname says nothing
//
// Storefront data is public, so trusting these headers is fine: they only say
// which public shop to show. Anything private still needs a login that belongs
// to that shop (see authMiddleware.js).

const platformDomain = () =>
  (process.env.PLATFORM_DOMAIN || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')

const cleanHost = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')

// A short memory of recent lookups, so a page load with 10 API calls doesn't
// read the same shop 10 times. Changes made through this server clear it.
const CACHE_MS = 30 * 1000
const cache = new Map()
export function forgetStore(store) {
  for (const [key, entry] of cache) {
    if (!store || String(entry.store?._id) === String(store._id || store)) cache.delete(key)
  }
}

async function lookup(key, query) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.store
  const store = await Store.findOne(query).lean()
  cache.set(key, { store, at: Date.now() })
  if (cache.size > 5000) cache.delete(cache.keys().next().value)
  return store
}

// Which shop does this hostname or slug mean? null if none.
export async function findStore({ host, slug }) {
  const domain = platformDomain()
  const h = cleanHost(host)

  if (h) {
    if (domain && h.endsWith(`.${domain}`)) {
      const sub = h.slice(0, -(domain.length + 1))
      // Only one level: amaka.platform.com, never a.b.platform.com
      if (sub && !sub.includes('.') && sub !== 'www') return lookup(`s:${sub}`, { slug: sub })
      if (sub === 'www') return null
    } else if (h !== domain && !/^(localhost|127\.0\.0\.1)$/.test(h) && !h.endsWith('.vercel.app') && !h.endsWith('.onrender.com')) {
      // Anything else is a merchant's own domain, used once verified
      const store = await lookup(`d:${h}`, { customDomain: h.replace(/^www\./, '') })
      return store?.customDomainVerified ? store : null
    }
  }

  // Development and previews: name the shop directly
  const s = cleanHost(slug)
  if (s && /^[a-z0-9-]{3,40}$/.test(s)) return lookup(`s:${s}`, { slug: s })
  return null
}

export async function resolveStore(req, res, next) {
  let store
  try {
    store = await findStore({
      host: req.get('x-store-host'),
      slug: req.get('x-store-slug') || process.env.DEFAULT_STORE_SLUG,
    })
  } catch (error) {
    console.error('Store lookup error:', error)
    return res.status(500).json({ message: 'Something went wrong' })
  }

  if (!store) {
    return res.status(404).json({ message: 'Shop not found', code: 'STORE_NOT_FOUND' })
  }

  req.store = store
  req.storeAccess = storeState(store)
  next()
}

// Who is looking, if they sent a login token. Never fails the request.
async function optionalUser(req) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET, { algorithms: ['HS256'] })
    return await User.findById(decoded.id).select('_id store')
  } catch {
    return null
  }
}

// Routes that must keep working while a shop is offline, so its owner can
// still sign in to preview, pay and publish.
const ALWAYS_OPEN = [
  /^\/api\/users\/(login|forgot-password|reset-password)$/,
  /^\/api\/store\/status$/,
]

// A shop that isn't live (never published, trial over, unpaid, suspended)
// is only visible to the people who run it. Everyone else gets "offline".
export async function storeOpen(req, res, next) {
  if (req.storeAccess.live) return next()
  if (ALWAYS_OPEN.some((rule) => rule.test(req.path)) || ALWAYS_OPEN.some((rule) => rule.test(req.originalUrl.split('?')[0]))) {
    return next()
  }

  const viewer = await optionalUser(req)
  if (viewer && canManageStore(viewer, req.store)) {
    req.isPreview = true
    return next()
  }

  return res.status(403).json({
    message: req.storeAccess.state === 'suspended' ? 'This shop is unavailable' : "This shop isn't open yet",
    code: 'STORE_OFFLINE',
    state: req.storeAccess.state === 'suspended' ? 'unavailable' : 'offline',
  })
}
