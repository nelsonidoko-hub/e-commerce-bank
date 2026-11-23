import express from 'express'
import {
  getPlans,
  getDemos,
  slugCheck,
  signup,
  login,
  platformProtect,
  getMe,
  createAnotherShop,
  adminLink,
  myDesigns,
  forgotPassword,
  resetPassword,
} from '../controllers/platformController.js'
import { loginLimiter, slugCheckLimiter, shopCreateLimiter, passwordResetLimiter } from '../middleware/rateLimiters.js'

// The platform's own site. Mounted in app.js BEFORE the shop lookup.
const router = express.Router()

router.get('/plans', getPlans)
router.get('/demos', getDemos)
router.get('/slug-check', slugCheckLimiter, slugCheck)
router.post('/signup', shopCreateLimiter, signup)
router.post('/login', loginLimiter, login)
router.post('/forgot-password', passwordResetLimiter, forgotPassword)
router.post('/reset-password', passwordResetLimiter, resetPassword)

router.get('/me', platformProtect, getMe)
router.post('/shops', platformProtect, shopCreateLimiter, createAnotherShop)
router.post('/shops/:id/admin-link', platformProtect, adminLink)
router.get('/designs', platformProtect, myDesigns)

export default router
