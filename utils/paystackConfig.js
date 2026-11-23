import crypto from 'crypto'
import PaymentConfig from '../models/PaymentConfig.js'
import { decrypt, encryptionReady } from '../config/secretBox.js'

// Read when used (not at load) because dotenv runs after imports.
// PAYSTACK_API_URL only exists so tests can point at a fake Paystack.
export const paystackApi = () => process.env.PAYSTACK_API_URL || 'https://api.paystack.co'

// Thrown when no usable key exists. publicMessage is safe to show customers.
export class PaymentSetupError extends Error {
  constructor() {
    super(
      "Paystack is not set up for this shop. Add the shop's secret key under Admin → Payments."
    )
    this.publicMessage = "Online payment isn't available right now. Please contact the store."
  }
}

// Each shop has its own Paystack account and key, and customers' money goes
// straight to that shop. There is deliberately NO fallback to a platform-wide
// key: a shop without its own key simply can't take payments yet, instead of
// sending its customers' money to someone else's account.

// Reading and decrypting on every payment would be wasteful, so each shop's
// answer is kept for a minute. Saving new keys clears it straight away.
const cache = new Map()
const CACHE_MS = 60 * 1000
export const clearPaystackCache = (storeId) => {
  if (storeId) cache.delete(String(storeId))
  else cache.clear()
}

export function getPaymentConfig(storeId) {
  if (!storeId) throw new Error('getPaymentConfig needs a store')
  return PaymentConfig.findOneAndUpdate(
    { store: storeId, key: 'paystack' },
    { $setOnInsert: { key: 'paystack' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  )
}

// Which key this shop uses right now: the one saved in Admin → Payments for
// the chosen mode. Returns { secret, mode, source: 'dashboard' | 'none', problem }
export async function resolvePaystack(storeId) {
  if (!storeId) throw new Error('resolvePaystack needs a store')
  const hit = cache.get(String(storeId))
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value

  let value = { secret: null, mode: null, source: 'none', problem: '' }

  try {
    const config = await getPaymentConfig(storeId)
    const stored = config.mode === 'live' ? config.liveSecretEnc : config.testSecretEnc

    if (stored) {
      if (!encryptionReady()) {
        value.problem = 'A key is saved, but SETTINGS_ENCRYPTION_KEY is missing on the server.'
      } else {
        try {
          value = { secret: decrypt(stored), mode: config.mode, source: 'dashboard', problem: '' }
        } catch {
          value.problem =
            'The saved key could not be read. The server encryption key may have changed. Save the key again.'
        }
      }
    }
  } catch (error) {
    console.error('Could not read Paystack settings:', error.message)
  }

  cache.set(String(storeId), { value, at: Date.now() })
  return value
}

export async function getPaystackSecret(storeId) {
  const { secret } = await resolvePaystack(storeId)
  if (!secret) throw new PaymentSetupError()
  return secret
}

// Paystack signs each webhook with the secret key. Only the key currently in
// use is accepted, so a test-mode event can never mark a live order as paid.
export function signatureMatches(rawBody, signature, secret) {
  const expected = crypto
    .createHmac('sha512', secret)
    .update(rawBody || '')
    .digest('hex')

  const a = Buffer.from(expected)
  const b = Buffer.from(signature || '')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}