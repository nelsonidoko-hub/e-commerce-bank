import express from 'express'
import { platformProtect } from '../controllers/platformController.js'
import upload from '../middleware/uploadMiddleware.js'
import { uploadStudioPicture, studioAccess, studioOptions, listStudio, getStudio, createStudio, updateStudio, setStudioStatus, deleteStudio } from '../controllers/studioController.js'

// The Template Studio (platform site, the founder and designers only)
const router = express.Router()
router.use(platformProtect, studioAccess)
router.get('/options', studioOptions)
// multer errors (too big, not a picture) come back as a readable message
router.post('/upload', (req, res, next) => upload.single('image')(req, res, (err) => (err ? res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'Picture is too large. The limit is 5 MB.' : err.message }) : next())), uploadStudioPicture)
router.get('/', listStudio)
router.post('/', createStudio)
router.get('/:id', getStudio)
router.put('/:id', updateStudio)
router.post('/:id/status', setStudioStatus)
router.delete('/:id', deleteStudio)

export default router
