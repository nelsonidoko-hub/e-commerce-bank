import cloudinary from '../config/cloudinary.js'

// Product photos (unchanged)
export const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' })
    }

    const uploadFromBuffer = () => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'abujastore' },
          (error, result) => {
            if (error) reject(error)
            else resolve(result)
          }
        )
        stream.end(req.file.buffer)
      })
    }

    const result = await uploadFromBuffer()

    res.json({ url: result.secure_url })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

// Hero banner: accepts an image or a video
export const uploadMediaFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' })
    }

    const isVideo = req.file.mimetype.startsWith('video/')

    // Cloudinary's free plan caps photos at 10 MB
    if (!isVideo && req.file.size > 10 * 1024 * 1024) {
      return res.status(400).json({ message: 'Photos must be under 10 MB' })
    }

    const uploadFromBuffer = () => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'abujastore/hero',
            // Without this, Cloudinary treats every upload as an image
            resource_type: isVideo ? 'video' : 'image',
          },
          (error, result) => {
            if (error) reject(error)
            else resolve(result)
          }
        )
        stream.end(req.file.buffer)
      })
    }

    const result = await uploadFromBuffer()

    res.json({ url: result.secure_url, mediaType: isVideo ? 'video' : 'image' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}