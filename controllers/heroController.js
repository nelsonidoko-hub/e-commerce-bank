import HeroSlide from '../models/HeroSlide.js'

const EDITABLE_FIELDS = [
  'mediaType',
  'mediaUrl',
  'heading',
  'text',
  'buttonLabel',
  'buttonLink',
  'order',
  'active',
]

// Public: only active slides, in display order
export const getSlides = async (req, res) => {
  try {
    const slides = await HeroSlide.find({ active: true }).sort({ order: 1, createdAt: 1 })
    res.json(slides)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

// Admin: every slide, including inactive ones
export const getAllSlides = async (req, res) => {
  try {
    const slides = await HeroSlide.find().sort({ order: 1, createdAt: 1 })
    res.json(slides)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const createSlide = async (req, res) => {
  try {
    const { mediaType, mediaUrl } = req.body

    if (!mediaUrl || !mediaUrl.trim()) {
      return res.status(400).json({ message: 'An image or video is required' })
    }

    if (mediaType && !['image', 'video'].includes(mediaType)) {
      return res.status(400).json({ message: 'mediaType must be "image" or "video"' })
    }

    // New slides go to the end of the line
    const count = await HeroSlide.countDocuments()

    const data = { order: count }
    for (const key of EDITABLE_FIELDS) {
      if (req.body[key] !== undefined && key !== 'order') data[key] = req.body[key]
    }

    const slide = await HeroSlide.create(data)
    res.status(201).json(slide)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}

export const updateSlide = async (req, res) => {
  try {
    const slide = await HeroSlide.findById(req.params.id)
    if (!slide) {
      return res.status(404).json({ message: 'Slide not found' })
    }

    if (req.body.mediaType && !['image', 'video'].includes(req.body.mediaType)) {
      return res.status(400).json({ message: 'mediaType must be "image" or "video"' })
    }

    for (const key of EDITABLE_FIELDS) {
      if (req.body[key] !== undefined) slide[key] = req.body[key]
    }

    const updated = await slide.save()
    res.json(updated)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}

export const deleteSlide = async (req, res) => {
  try {
    const slide = await HeroSlide.findById(req.params.id)
    if (!slide) {
      return res.status(404).json({ message: 'Slide not found' })
    }

    await slide.deleteOne()
    res.json({ message: 'Slide removed' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}