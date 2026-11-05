import crypto from 'crypto'

// Encrypts secrets (like the Paystack key) before they are saved in the database.
//
// The encryption key comes from the SETTINGS_ENCRYPTION_KEY environment
// variable on the server, so someone who only gets a copy of the database
// cannot read the keys. It is deliberately separate from JWT_SECRET: changing
// JWT_SECRET (which just signs people out) must never make saved keys unreadable.
//
// It is read when needed, not when this file loads, because server.js calls
// dotenv.config() after its imports have run.
function getKey() {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY
  if (!secret || secret.length < 32) return null
  return crypto.createHash('sha256').update(secret).digest() // exactly 32 bytes
}

export const encryptionReady = () => getKey() !== null

// Returns "iv.tag.data" (each part base64). GCM also detects tampering.
export function encrypt(plainText) {
  const key = getKey()
  if (!key) throw new Error('SETTINGS_ENCRYPTION_KEY is not set')

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [iv, tag, data].map((part) => part.toString('base64')).join('.')
}

export function decrypt(payload) {
  const key = getKey()
  if (!key) throw new Error('SETTINGS_ENCRYPTION_KEY is not set')

  const [iv, tag, data] = String(payload)
    .split('.')
    .map((part) => Buffer.from(part, 'base64'))

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}