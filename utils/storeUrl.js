import { planFor } from './plans.js'

// A shop's public web address, for payment return links and emails.
//   1. its own verified domain              https://amaka.com
//   2. its address on the platform          https://amaka.yourplatform.com
//   3. while developing (no PLATFORM_DOMAIN) FRONTEND_URL with ?store=amaka,
//      so the storefront on localhost knows which shop it is
export function storeUrl(store, path = '/') {
  const p = path.startsWith('/') ? path : `/${path}`

  if (store?.customDomain && store.customDomainVerified && planFor(store).customDomain) {
    return `https://${store.customDomain}${p}`
  }

  const domain = (process.env.PLATFORM_DOMAIN || '').trim().toLowerCase()
  if (domain) return `https://${store.slug}.${domain}${p}`

  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '')
  const joiner = p.includes('?') ? '&' : '?'
  return `${base}${p}${joiner}store=${encodeURIComponent(store.slug)}`
}

// Where Paystack should send this shop's payment events. Each shop has its own
// address, so the server knows which shop's key to check the signature with.
export function webhookUrl(store) {
  const api = (process.env.API_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '')
  return `${api}/api/payments/webhook/${store._id}`
}
