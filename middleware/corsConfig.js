import cors from 'cors'

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

const corsMiddleware = cors({
  origin(origin, callback) {
    // No Origin header means it isn't a browser page (Paystack's servers,
    // health checks, curl), so CORS doesn't apply.
    if (!origin) return callback(null, true)

    // While developing, any localhost port is fine
    if (process.env.NODE_ENV !== 'production' && LOCALHOST.test(origin)) {
      return callback(null, true)
    }

    const allowed = configuredOrigins()

    // Nothing configured: don't lock the store out, but say so loudly
    if (allowed.length === 0) {
      if (!warned) {
        console.warn(
          'CORS: set CORS_ORIGINS (or FRONTEND_URL) so only your storefront can call this API.'
        )
        warned = true
      }
      return callback(null, true)
    }

    callback(null, allowed.includes(origin))
  },
})

export default corsMiddleware