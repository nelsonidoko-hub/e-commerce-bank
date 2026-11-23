import express from 'express'
import { getStoreStatus, getSetup, publishStore, removeSamples } from '../controllers/storeController.js'
import { protect, admin, optionalLogin } from '../middleware/authMiddleware.js'

const router = express.Router()

router.get('/status', optionalLogin, getStoreStatus)
router.get('/setup', protect, admin, getSetup)
router.post('/publish', protect, admin, publishStore)
router.delete('/samples', protect, admin, removeSamples)

export default router
