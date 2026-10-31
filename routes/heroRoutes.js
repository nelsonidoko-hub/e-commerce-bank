import express from 'express'
import {
  getSlides,
  getAllSlides,
  createSlide,
  updateSlide,
  deleteSlide,
} from '../controllers/heroController.js'
import { protect, admin } from '../middleware/authMiddleware.js'

const router = express.Router()

// Public — the storefront hero reads these
router.get('/', getSlides)

// Admin only
router.get('/all', protect, admin, getAllSlides)
router.post('/', protect, admin, createSlide)
router.put('/:id', protect, admin, updateSlide)
router.delete('/:id', protect, admin, deleteSlide)

export default router