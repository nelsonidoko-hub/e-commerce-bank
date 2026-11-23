import express from 'express'
import { initializePayment, verifyPayment } from '../controllers/paymentController.js'
import { protect } from '../middleware/authMiddleware.js'

// The Paystack webhook is mounted separately in server.js, before the shop
// lookup, because Paystack's servers don't say which shop they are calling for
// except through the address itself.
const router = express.Router()

router.post('/initialize', protect, initializePayment)
router.get('/verify/:reference', protect, verifyPayment)

export default router
