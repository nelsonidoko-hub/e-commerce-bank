import express from 'express'
import { getBilling, checkout, confirm, changePlan, setAutoRenew } from '../controllers/billingController.js'
import { protect, admin } from '../middleware/authMiddleware.js'
import { paymentSettingsLimiter } from '../middleware/rateLimiters.js'

// A shop paying the platform. Admin of the current shop only.
// (The Paystack webhook for these payments is mounted in app.js.)
const router = express.Router()
router.use(protect, admin)

router.get('/', getBilling)
router.post('/checkout', paymentSettingsLimiter, checkout)
router.post('/confirm', confirm)
router.post('/plan', changePlan)
router.post('/auto-renew', setAutoRenew)

export default router
