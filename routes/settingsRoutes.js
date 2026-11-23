import express from 'express'
import { getSettings, updateSettings, getDraft, saveDraft, publishDraft, discardDraft } from '../controllers/settingsController.js'
import { protect, admin, optionalLogin } from '../middleware/authMiddleware.js'

const router = express.Router()

// Public: the storefront (footer, checkout, homepage) reads this.
// The login is optional: the owner's preview (?preview=1) sees the draft.
router.get('/', optionalLogin, getSettings)

// Admin only
router.put('/', protect, admin, updateSettings)

// The builder's unpublished draft
router.get('/draft', protect, admin, getDraft)
router.put('/draft', protect, admin, saveDraft)
router.post('/draft/publish', protect, admin, publishDraft)
router.delete('/draft', protect, admin, discardDraft)

export default router
