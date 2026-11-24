import express from 'express'
import { platformProtect } from '../controllers/platformController.js'
import { studioAccess, studioOptions, listStudio, getStudio, createStudio, updateStudio, setStudioStatus, deleteStudio } from '../controllers/studioController.js'

// The Template Studio (platform site, the founder and designers only)
const router = express.Router()
router.use(platformProtect, studioAccess)
router.get('/options', studioOptions)
router.get('/', listStudio)
router.post('/', createStudio)
router.get('/:id', getStudio)
router.put('/:id', updateStudio)
router.post('/:id/status', setStudioStatus)
router.delete('/:id', deleteStudio)

export default router
