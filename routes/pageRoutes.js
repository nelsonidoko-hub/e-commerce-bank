import express from 'express'
import {
  getPublicPages,
  getPageBySlug,
  getAllPages,
  createPage,
  updatePage,
  deletePage,
} from '../controllers/pageController.js'
import { protect, admin } from '../middleware/authMiddleware.js'

const router = express.Router()

// Public: the footer list, and a single page by its address
router.get('/', getPublicPages)

// Must come before '/:slug' so "all" isn't treated as a page address
router.get('/all', protect, admin, getAllPages)

router.get('/:slug', getPageBySlug)

// Admin only
router.post('/', protect, admin, createPage)
router.put('/:id', protect, admin, updatePage)
router.delete('/:id', protect, admin, deletePage)

export default router