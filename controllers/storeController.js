import { planFor, publicPlans, trialDays, graceDays } from '../utils/plans.js'
import { canManageStore } from '../utils/storeAccess.js'
import { storeUrl, webhookUrl } from '../utils/storeUrl.js'

// GET /api/store/status
// Everyone: the shop's name and whether it is open.
// The people who run it also see their plan, trial and billing dates.
// Works even while the shop is offline, so the owner can see why.
export const getStoreStatus = async (req, res) => {
  const store = req.store
  const access = req.storeAccess

  const body = {
    name: store.name,
    slug: store.slug,
    live: access.live,
    // Visitors only learn "open" or "not open", never billing details
    state: access.live ? 'open' : access.state === 'suspended' ? 'unavailable' : 'offline',
    poweredBy: planFor(store).poweredBy,
  }

  if (req.user && canManageStore(req.user, store)) {
    body.manage = {
      state: access.state, // draft | trial | active | grace | paused | suspended
      until: access.until || null,
      plan: store.plan,
      planDetails: { ...planFor(store), productLimit: Number.isFinite(planFor(store).productLimit) ? planFor(store).productLimit : null },
      plans: publicPlans(),
      trialDays: trialDays(),
      graceDays: graceDays(),
      publishedAt: store.publishedAt,
      trialEndsAt: store.trialEndsAt,
      currentPeriodEnd: store.currentPeriodEnd,
      url: storeUrl(store),
      webhookUrl: webhookUrl(store),
      suspendedReason: access.state === 'suspended' ? store.suspendedReason : '',
    }
  }

  res.json(body)
}
