import express from 'express'
import {
  registerUser,
  loginUser,
  getAllCustomers,
  forgotPassword,
  resetPassword,
  exchangeCode,
} from '../controllers/authController.js'
import { protect, admin } from '../middleware/authMiddleware.js'
import {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
} from '../middleware/rateLimiters.js'

const router = express.Router()

router.post('/register', registerLimiter, registerUser)
router.post('/login', loginLimiter, loginUser)
router.post('/exchange-code', loginLimiter, exchangeCode)
router.get('/customers', protect, admin, getAllCustomers)
router.post('/forgot-password', passwordResetLimiter, forgotPassword)
router.post('/reset-password', passwordResetLimiter, resetPassword)

export default router