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