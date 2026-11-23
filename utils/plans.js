// Plan prices and limits, read from the server's environment variables, so the
// platform owner can change them on Render (Environment tab) without new code.
//
//   PLAN_BASIC_PRICE      monthly price of Basic in Naira      (default 5000)
//   PLAN_PRO_PRICE        monthly price of Pro in Naira        (default 12000)
//   TRIAL_DAYS            free days of live selling            (default 7)
//   GRACE_DAYS            days a shop stays live after a
//                         missed payment                       (default 7)
//   BASIC_PRODUCT_LIMIT   most products a Basic shop can have  (default 100)
//
// Values are read every time they are needed, so a change on Render applies as
// soon as the server restarts with it. A bad value (empty, negative, "abc")
// falls back to the default and is reported once in the server log.

const DEFAULTS = {
  PLAN_BASIC_PRICE: 5000,
  PLAN_PRO_PRICE: 12000,
  TRIAL_DAYS: 7,
  GRACE_DAYS: 7,
  BASIC_PRODUCT_LIMIT: 100,
}

// Sensible ceilings, so a typo like 70000 trial days can't give shops away
const MAXIMUMS = {
  PLAN_BASIC_PRICE: 10_000_000,
  PLAN_PRO_PRICE: 10_000_000,
  TRIAL_DAYS: 90,
  GRACE_DAYS: 60,
  BASIC_PRODUCT_LIMIT: 1_000_000,
}

const warned = new Set()

export function envNumber(name) {
  const raw = process.env[name]
  if (raw === undefined || String(raw).trim() === '') return DEFAULTS[name]

  const value = Number(String(raw).replace(/[,_\s₦]/g, ''))
  const valid = Number.isInteger(value) && value >= 0 && value <= MAXIMUMS[name]
  if (!valid) {
    if (!warned.has(name)) {
      console.warn(`Plans: ${name}="${raw}" is not a whole number from 0 to ${MAXIMUMS[name]}. Using ${DEFAULTS[name]}.`)
      warned.add(name)
    }
    return DEFAULTS[name]
  }
  return value
}

export function getPlans() {
  return {
    basic: {
      id: 'basic',
      name: 'Basic',
      price: envNumber('PLAN_BASIC_PRICE'),
      productLimit: envNumber('BASIC_PRODUCT_LIMIT'),
      customDomain: false,
      staffAccounts: false,
      ownTemplates: false,
      poweredBy: true,
    },
    pro: {
      id: 'pro',
      name: 'Pro',
      price: envNumber('PLAN_PRO_PRICE'),
      productLimit: Infinity,
      customDomain: true,
      staffAccounts: true,
      ownTemplates: true,
      poweredBy: false,
    },
  }
}

export const trialDays = () => envNumber('TRIAL_DAYS')
export const graceDays = () => envNumber('GRACE_DAYS')

export function planFor(store) {
  const plans = getPlans()
  return plans[store?.plan] || plans.basic
}

// For sending to the browser (Infinity doesn't survive JSON)
export function publicPlans() {
  return Object.values(getPlans()).map((p) => ({
    ...p,
    productLimit: Number.isFinite(p.productLimit) ? p.productLimit : null,
  }))
}
