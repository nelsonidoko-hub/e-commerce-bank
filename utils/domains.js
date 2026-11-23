import crypto from 'crypto'
import dns from 'dns'
import axios from 'axios'

// Pro shops using their own web address (amakakitchen.com).
//
// 1. The merchant enters the domain. It is saved as NOT verified, with a
//    random token, so nobody can claim a domain they don't own.
// 2. They add two DNS records at their domain registrar:
//      TXT   _shopverify.amakakitchen.com  = <token>   (proves ownership)
//      A     amakakitchen.com              = 76.76.21.21           (Vercel)
//      CNAME www.amakakitchen.com          = cname.vercel-dns.com  (Vercel)
//    Vercel now gives each project its own CNAME target (shown on the
//    project's domain card, e.g. d1d4fc829fe7bc7c.vercel-dns-017.com), so set
//    CUSTOM_DOMAIN_CNAME (and CUSTOM_DOMAIN_A if it differs) on Render to the
//    values your Vercel project shows. The defaults are Vercel's general ones.
// 3. "Verify" looks up the TXT record. When it matches, the domain is
//    switched on and, if VERCEL_TOKEN and VERCEL_PROJECT_ID are set on
//    Render, added to the Vercel project automatically (Vercel then issues the
//    security certificate). Without them, the founder adds it in Vercel.

export const VERIFY_PREFIX = '_shopverify'
export class DomainError extends Error {}

const HOSTNAME = /^(?=.{4,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/

export function normalizeDomain(input) {
  let d = String(input || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '')
  d = d.replace(/^www\./, '')
  if (!HOSTNAME.test(d) || d.split('.').some((label) => label.startsWith('-') || label.endsWith('-'))) {
    throw new DomainError('Enter a domain like amakakitchen.com')
  }
  const platform = (process.env.PLATFORM_DOMAIN || '').trim().toLowerCase()
  if (platform && (d === platform || d.endsWith(`.${platform}`))) throw new DomainError('That is already a platform address')
  if (/(^|\.)(vercel\.app|onrender\.com|localhost|paystack\.co|paystack\.com)$/.test(d)) throw new DomainError("That domain can't be used")
  return d
}

export const newToken = () => `shop-verify-${crypto.randomBytes(12).toString('hex')}`

export function dnsRecords(domain, token) {
  return [
    { type: 'TXT', name: `${VERIFY_PREFIX}.${domain}`, value: token, purpose: 'Proves the domain is yours' },
    { type: 'A', name: domain, value: process.env.CUSTOM_DOMAIN_A || '76.76.21.21', purpose: 'Points your domain at your shop' },
    { type: 'CNAME', name: `www.${domain}`, value: process.env.CUSTOM_DOMAIN_CNAME || 'cname.vercel-dns.com', purpose: 'Points www at your shop' },
  ]
}

// Swappable for tests (no real DNS lookups there)
let resolveTxt = (name) => dns.promises.resolveTxt(name)
export function setTxtResolver(fn) {
  resolveTxt = fn
}

// Does the TXT record hold the token? Returns { ok, found }
export async function checkOwnership(domain, token) {
  try {
    const records = await resolveTxt(`${VERIFY_PREFIX}.${domain}`)
    const values = records.map((parts) => parts.join(''))
    return { ok: values.includes(token), found: values }
  } catch {
    return { ok: false, found: [] }
  }
}

const vercelReady = () => Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID)
const vercelApi = () => process.env.VERCEL_API_URL || 'https://api.vercel.com'
const vercelQuery = () => (process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : '')

// Adds the domain and its www to the Vercel project. Returns 'added' | 'manual' | 'error'
export async function addToHosting(domain) {
  if (!vercelReady()) return { hosting: 'manual', error: '' }
  try {
    for (const name of [domain, `www.${domain}`]) {
      await axios
        .post(
          `${vercelApi()}/v10/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains${vercelQuery()}`,
          { name },
          { headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` }, timeout: 15000 }
        )
        .catch((error) => {
          // already on the project is fine
          if (error.response?.status !== 409) throw error
        })
    }
    return { hosting: 'added', error: '' }
  } catch (error) {
    return { hosting: 'error', error: String(error.response?.data?.error?.message || error.message).slice(0, 200) }
  }
}

export async function removeFromHosting(domain) {
  if (!vercelReady()) return
  for (const name of [domain, `www.${domain}`]) {
    await axios
      .delete(`${vercelApi()}/v9/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains/${encodeURIComponent(name)}${vercelQuery()}`, {
        headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
        timeout: 15000,
      })
      .catch(() => {})
  }
}
