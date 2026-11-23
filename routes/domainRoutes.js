import express from 'express'
import { getDomain, setDomain, verifyDomain, removeDomain } from '../controllers/domainController.js'
import { protect, admin } from '../middleware/authMiddleware.js'
import { paymentSettingsLimiter } from '../middleware/rateLimiters.js'

const router = express.Router()
router.use(protect, admin)

router.get('/', getDomain)
router.put('/', paymentSettingsLimiter, setDomain)
router.post('/verify', paymentSettingsLimiter, verifyDomain)
router.delete('/', removeDomain)

export default router
