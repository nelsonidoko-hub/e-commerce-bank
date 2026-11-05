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
      'Paystack is not set up. Add a secret key under Admin → Payments, or set PAYSTACK_SECRET_KEY on the server.'
    )
    this.publicMessage = "Online payment isn't available right now. Please contact the store."
  }
}

const modeOfKey = (key) =>
  key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'unknown'

// Reading and decrypting on every payment would be wasteful, so the answer is
// kept for a minute. Saving new keys clears it straight away.
let cache = null
const CACHE_MS = 60 * 1000
export const clearPaystackCache = () => {
  cache = null
}

export function getPaymentConfig() {
  return PaymentConfig.findOneAndUpdate(
    { key: 'paystack' },
    { $setOnInsert: { key: 'paystack' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  )
}

// Which key is in use right now, and where it came from:
//   1. the key saved in Admin → Payments for the chosen mode
//   2. otherwise the PAYSTACK_SECRET_KEY environment variable (how the store worked before)
// Returns { secret, mode, source: 'dashboard' | 'environment' | 'none', problem }
export async function resolvePaystack() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value

  let value = { secret: null, mode: null, source: 'none', problem: '' }

  try {
    const config = await getPaymentConfig()
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

  if (!value.secret && process.env.PAYSTACK_SECRET_KEY) {
    const secret = process.env.PAYSTACK_SECRET_KEY
    value = { secret, mode: modeOfKey(secret), source: 'environment', problem: value.problem }
  }

  cache = { value, at: Date.now() }
  return value
}

export async function getPaystackSecret() {
  const { secret } = await resolvePaystack()
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