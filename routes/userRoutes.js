import express from 'express'
import {
  registerUser,
  loginUser,
  registerAdmin,
  getAllCustomers,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js'
import { protect, admin } from '../middleware/authMiddleware.js'
import {
  loginLimiter,
  registerLimiter,
  passwordResetLimiter,
  adminSetupLimiter,
} from '../middleware/rateLimiters.js'

const router = express.Router()

router.post('/register', registerLimiter, registerUser)
router.post('/login', loginLimiter, loginUser)
router.post('/register-admin', adminSetupLimiter, registerAdmin)
router.get('/customers', protect, admin, getAllCustomers)
router.post('/forgot-password', passwordResetLimiter, forgotPassword)
router.post('/reset-password', passwordResetLimiter, resetPassword)

export default router