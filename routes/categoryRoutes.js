import express from 'express'
import {
  getCategories,
  getFlatCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoryController.js'
import { protect, admin } from '../middleware/authMiddleware.js'

const router = express.Router()

// Public — storefront navbar and product form both need to read these
router.get('/', getCategories)
router.get('/flat', getFlatCategories)

// Admin only — managing the category list itself
router.post('/', protect, admin, createCategory)
router.put('/:id', protect, admin, updateCategory)
router.delete('/:id', protect, admin, deleteCategory)

export default router