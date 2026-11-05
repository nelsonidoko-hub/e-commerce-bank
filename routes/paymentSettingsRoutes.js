import express from 'express'
import {
  getPaymentSettings,
  updatePaymentSettings,
  testPaystackConnection,
} from '../controllers/paymentSettingsController.js'
import { protect, admin } from '../middleware/authMiddleware.js'
import { paymentSettingsLimiter } from '../middleware/rateLimiters.js'

const router = express.Router()

// Every route here is admin only
router.use(protect, admin)

router.get('/', getPaymentSettings)
router.put('/', paymentSettingsLimiter, updatePaymentSettings)
router.post('/test', testPaystackConnection)

export default router