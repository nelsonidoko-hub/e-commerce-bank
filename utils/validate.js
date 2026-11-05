import crypto from 'crypto'

export const isString = (value) => typeof value === 'string'

// bcrypt only reads the first 72 characters, so longer passwords are refused
// rather than silently cut short.
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 72

// Returns a tidy lowercase email, or null if it isn't one.
// Requiring a string also stops query tricks like { "$gt": "" } in the email field.
export function cleanEmail(value) {
  if (!isString(value)) return null
  const email = value.trim().toLowerCase()
  if (email.length > 254) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export function cleanName(value) {
  if (!isString(value)) return null
  const name = value.trim()
  return name.length >= 1 && name.length <= 80 ? name : null
}

export function validPassword(value) {
  return (
    isString(value) && value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH
  )
}

// Compares two secrets without leaking how much of them matched.
// Hashing first means different lengths don't cause an error or a timing clue.
export function safeEqual(a, b) {
  if (!isString(a) || !isString(b)) return false
  const hashA = crypto.createHash('sha256').update(a).digest()
  const hashB = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(hashA, hashB)
}

// Makes visitor-typed text safe to put inside a regular expression
export const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')