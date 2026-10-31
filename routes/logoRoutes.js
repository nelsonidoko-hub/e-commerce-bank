import express from 'express'
import {
  getLogo,
  createLogo,
  updateLogo,
  saveLogo,
} from '../controllers/logoController.js'
import { protect, admin } from '../middleware/authMiddleware.js'

const router = express.Router()

// Public — the storefront navbar needs to display the logo
router.get('/', getLogo)

// Admin only — create the initial store logo
router.post('/', protect, admin, createLogo)

// Admin only — update the existing store logo
router.put('/', protect, admin, updateLogo)

// Admin only — create or update the logo in one request
router.put('/save', protect, admin, saveLogo)

export default router
