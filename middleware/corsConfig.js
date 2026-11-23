import cors from 'cors'
import { findStore } from './storeMiddleware.js'

let warned = false

// Read at request time, not when this file loads: server.js calls
// dotenv.config() after its imports have run, so the env variables
// don't exist yet at load time.
function configuredOrigins() {
  return (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

// Which web pages may call this API from a browser:
//   - the platform itself and every shop on it: https://<anything>.PLATFORM_DOMAIN
//   - a shop's own domain, once verified
//   - anything listed in CORS_ORIGINS (e.g. a Vercel preview address)
//   - any localhost port while developing
export async function originAllowed(origin) {
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }

  if (process.env.NODE_ENV !== 'production' && LOCALHOST.test(origin)) return true
  if (configuredOrigins().includes(origin)) return true

  // Only real https sites from here on
  if (url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase()

  const domain = (process.env.PLATFORM_DOMAIN || '').trim().toLowerCase()
  if (domain && (host === domain || host === `www.${domain}`)) return true
  if (domain && host.endsWith(`.${domain}`)) {
    const sub = host.slice(0, -(domain.length + 1))
    return /^[a-z0-9-]+$/.test(sub)
  }

  // A merchant's own domain counts once it is verified
  try {
    return Boolean(await findStore({ host }))
  } catch {
    return false
  }
}

const corsMiddleware = cors({
  async origin(origin, callback) {
    // No Origin header means it isn't a browser page (Paystack's servers,
    // health checks, curl), so CORS doesn't apply.
    if (!origin) return callback(null, true)

    if (!process.env.PLATFORM_DOMAIN && configuredOrigins().length === 0 && process.env.NODE_ENV !== 'production') {
      if (!warned) {
        console.warn('CORS: set PLATFORM_DOMAIN (and CORS_ORIGINS for previews) so only your shops can call this API.')
        warned = true
      }
      return callback(null, true)
    }

    callback(null, await originAllowed(origin))
  },
  // The storefront says which shop it is with these
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Store-Host', 'X-Store-Slug'],
})

export default corsMiddleware
