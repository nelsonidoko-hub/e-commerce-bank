import express from 'express'
import {
  getDiscounts,
  createDiscount,
  updateDiscount,
  deleteDiscount,
  validateDiscountCode,
} from '../controllers/discountController.js'
import { protect, admin } from '../middleware/authMiddleware.js'

const router = express.Router()

// Any logged-in customer can check a code at checkout
router.post('/validate', protect, validateDiscountCode)

// Admin only
router.get('/', protect, admin, getDiscounts)
router.post('/', protect, admin, createDiscount)
router.put('/:id', protect, admin, updateDiscount)
router.delete('/:id', protect, admin, deleteDiscount)

export default router