import rateLimit from 'express-rate-limit'

// Limits are per visitor address. The response has a "message" field, the same
// shape every other error in the app uses, so the frontend shows it as usual.
const makeLimiter = (minutes, limit, message, options = {}) =>
  rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message },
    ...options,
  })

// Only failed logins count, so a real customer who logs in fine is never blocked
export const loginLimiter = makeLimiter(
  15,
  10,
  'Too many login attempts. Please wait 15 minutes and try again.',
  { skipSuccessfulRequests: true }
)

export const registerLimiter = makeLimiter(
  60,
  10,
  'Too many accounts were created from this connection. Please try again later.'
)

export const passwordResetLimiter = makeLimiter(
  60,
  5,
  'Too many password reset requests. Please try again in an hour.'
)

export const adminSetupLimiter = makeLimiter(
  60,
  5,
  'Too many attempts. Please try again later.'
)

// Only wrong codes count, which is what stops someone guessing codes
export const discountCheckLimiter = makeLimiter(
  10,
  30,
  'Too many code attempts. Please wait a few minutes and try again.',
  { skipSuccessfulRequests: true }
)

// Only failed attempts count, so repeatedly guessing the password is blocked
export const paymentSettingsLimiter = makeLimiter(
  60,
  10,
  'Too many attempts. Please try again in an hour.',
  { skipSuccessfulRequests: true }
)
// Checking whether a shop address is free, while the merchant types
export const slugCheckLimiter = makeLimiter(1, 60, 'Too many checks. Please slow down.')

// Opening a new shop: a few per hour per visitor is plenty
export const shopCreateLimiter = makeLimiter(60, 10, 'Too many new shops from here. Please try again later.')

// Market Square: counting clicks and reporting listings
export const marketClickLimiter = makeLimiter(1, 60, 'Too many requests. Please slow down.')
export const marketReportLimiter = makeLimiter(60, 10, 'Too many reports from here. Please try again later.')
