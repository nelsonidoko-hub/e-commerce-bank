import Store from '../models/Store.js'
import { planFor } from '../utils/plans.js'
import { forgetStore } from '../middleware/storeMiddleware.js'
import { normalizeDomain, newToken, dnsRecords, checkOwnership, addToHosting, removeFromHosting, DomainError } from '../utils/domains.js'

// The shop's own web address (Pro). Admin of the current shop only.

const view = (store) => ({
  allowed: planFor(store).customDomain,
  domain: store.customDomain || '',
  verified: Boolean(store.customDomainVerified),
  hosting: store.customDomainHosting || '',
  error: store.customDomainError || '',
  records: store.customDomain ? dnsRecords(store.customDomain, store.customDomainToken) : [],
})

const fresh = (req) => Store.findById(req.store._id)

// GET /api/domain
export const getDomain = async (req, res) => {
  try {
    res.json(view(await fresh(req)))
  } catch (error) {
    console.error('getDomain error:', error)
    res.status(500).json({ message: 'Something went wrong' })
  }
}

// PUT /api/domain  { domain }: saves it, not yet verified
export const setDomain = async (req, res) => {
  try {
    const store = await fresh(req)
    if (!planFor(store).customDomain) {
      return res.status(403).json({ message: 'Using your own domain is part of the Pro plan.', code: 'PLAN_LIMIT' })
    }
    let domain
    try {
      domain = normalizeDomain(req.body?.domain)
    } catch (error) {
      if (error instanceof DomainError) return res.status(400).json({ message: error.message })
      throw error
    }
    if (domain === store.customDomain) return res.json(view(store))

    const taken = await Store.exists({ customDomain: domain, _id: { $ne: store._id } })
    if (taken) return res.status(400).json({ message: 'That domain is already connected to another shop' })

    const old = store.customDomainVerified ? store.customDomain : ''
    store.customDomain = domain
    store.customDomainVerified = false
    store.customDomainToken = newToken()
    store.customDomainHosting = ''
    store.customDomainError = ''
    try {
      await store.save()
    } catch (error) {
      if (error.code === 11000) return res.status(400).json({ message: 'That domain is already connected to another shop' })
      throw error
    }
    if (old) removeFromHosting(old).catch(() => {})
    forgetStore(store)
    res.json(view(store))
  } catch (error) {
    console.error('setDomain error:', error)
    res.status(500).json({ message: 'Something went wrong' })
  }
}

// POST /api/domain/verify: checks the TXT record, then switches the domain on
export const verifyDomain = async (req, res) => {
  try {
    const store = await fresh(req)
    if (!store.customDomain) return res.status(400).json({ message: 'Add a domain first' })
    if (!planFor(store).customDomain) return res.status(403).json({ message: 'Using your own domain is part of the Pro plan.', code: 'PLAN_LIMIT' })

    const check = await checkOwnership(store.customDomain, store.customDomainToken)
    if (!check.ok) {
      return res.status(400).json({
        message: check.found.length
          ? "We found a TXT record, but its value doesn't match. Copy the value exactly."
          : "We couldn't find the TXT record yet. DNS changes can take up to a few hours; try again later.",
        ...view(store),
      })
    }
    const hosting = await addToHosting(store.customDomain)
    store.customDomainVerified = true
    store.customDomainHosting = hosting.hosting
    store.customDomainError = hosting.error
    await store.save()
    forgetStore(store)
    res.json(view(store))
  } catch (error) {
    console.error('verifyDomain error:', error)
    res.status(500).json({ message: 'Something went wrong' })
  }
}

// DELETE /api/domain: back to the platform address only
export const removeDomain = async (req, res) => {
  try {
    const store = await fresh(req)
    const old = store.customDomainVerified ? store.customDomain : ''
    store.customDomain = undefined
    store.customDomainVerified = false
    store.customDomainToken = ''
    store.customDomainHosting = ''
    store.customDomainError = ''
    await store.save()
    if (old) removeFromHosting(old).catch(() => {})
    forgetStore(store)
    res.json(view(store))
  } catch (error) {
    console.error('removeDomain error:', error)
    res.status(500).json({ message: 'Something went wrong' })
  }
}
