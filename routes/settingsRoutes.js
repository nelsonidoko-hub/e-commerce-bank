import express from 'express'
import { getSettings, updateSettings } from '../controllers/settingsController.js'
import { protect, admin } from '../middleware/authMiddleware.js'

const router = express.Router()

// Public: the storefront (footer, checkout, announcement bar) reads this
router.get('/', getSettings)

// Admin only
router.put('/', protect, admin, updateSettings)

export default router