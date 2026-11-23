import { graceDays, planFor } from './plans.js'

const DAY = 24 * 60 * 60 * 1000

// Where a shop stands right now, worked out from its dates:
//   suspended  switched off by the platform owner
//   draft      never published; only the merchant can see it (free preview)
//   trial      published, inside the free trial
//   active     paid up
//   grace      payment missed, still live for GRACE_DAYS while reminders go out
//   paused     trial or grace ran out; hidden until the merchant pays
// Nothing is ever deleted when a shop pauses.
export function storeState(store, now = new Date()) {
  if (!store) return { state: 'missing', live: false }
  if (store.suspended) return { state: 'suspended', live: false }
  if (!store.publishedAt) return { state: 'draft', live: false }

  const t = now.getTime()
  const paidUntil = store.currentPeriodEnd ? new Date(store.currentPeriodEnd).getTime() : 0
  const trialUntil = store.trialEndsAt ? new Date(store.trialEndsAt).getTime() : 0

  if (paidUntil > t) return { state: 'active', live: true, until: new Date(paidUntil) }
  if (trialUntil > t) return { state: 'trial', live: true, until: new Date(trialUntil) }

  // Grace only follows a missed payment, not the end of a free trial
  if (paidUntil) {
    const graceUntil = paidUntil + graceDays() * DAY
    if (graceUntil > t) return { state: 'grace', live: true, until: new Date(graceUntil) }
  }
  return { state: 'paused', live: false }
}

// Can this user run this shop's admin? The owner, or listed staff while the
// shop is on a plan that includes staff accounts.
export function canManageStore(user, store) {
  if (!user || !store) return false
  if (user.store) return false // customer accounts never manage a shop
  const id = String(user._id)
  if (String(store.owner) === id) return true
  if (!planFor(store).staffAccounts) return false
  return (store.staff || []).some((s) => String(s) === id)
}
