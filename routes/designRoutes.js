import express from 'express'
import { listDesigns, saveDesign, applyDesign, deleteDesign } from '../controllers/designController.js'
import { protect, admin } from '../middleware/authMiddleware.js'

// "My templates" inside a shop's builder. Admin of the current shop only.
const router = express.Router()
router.use(protect, admin)

router.get('/', listDesigns)
router.post('/', saveDesign)
router.post('/:id/apply', applyDesign)
router.delete('/:id', deleteDesign)

export default router
