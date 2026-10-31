import express from 'express'
import { uploadImage, uploadMediaFile } from '../controllers/uploadController.js'
import { protect, admin } from '../middleware/authMiddleware.js'
import upload, { uploadMedia } from '../middleware/uploadMiddleware.js'

const router = express.Router()

// Product photos (unchanged)
router.post('/', protect, admin, upload.single('image'), uploadImage)

// Hero banner media (image or video).
// Wrapped so multer errors (file too big, wrong type) come back as readable
// JSON messages instead of an HTML error page.
const handleMediaUpload = (req, res, next) => {
  uploadMedia.single('file')(req, res, (err) => {
    if (err) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'File is too large. The limit is 50 MB for videos and 10 MB for photos.'
          : err.message
      return res.status(400).json({ message })
    }
    next()
  })
}

router.post('/media', protect, admin, handleMediaUpload, uploadMediaFile)

export default router