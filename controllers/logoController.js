import Logo from '../models/Logo.js'

// Get the store logo
export const getLogo = async (req, res) => {
  try {
    const logo = await Logo.findOne({ name: 'main' })

    if (!logo) {
      return res.status(404).json({ message: 'Logo not found' })
    }

    res.json(logo)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

// Create the store logo
export const createLogo = async (req, res) => {
  try {
    const { imageUrl, altText } = req.body

    if (!imageUrl) {
      return res.status(400).json({
        message: 'Logo image URL is required',
      })
    }

    // Only one main logo is allowed
    const existingLogo = await Logo.findOne({ name: 'main' })

    if (existingLogo) {
      return res.status(400).json({
        message: 'A store logo already exists. Update it instead.',
      })
    }

    const logo = await Logo.create({
      name: 'main',
      imageUrl: imageUrl.trim(),
      altText: altText?.trim() || 'Abuja Store Logo',
      updatedBy: req.user?._id || null,
    })

    res.status(201).json(logo)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}

// Update the store logo
export const updateLogo = async (req, res) => {
  try {
    const logo = await Logo.findOne({ name: 'main' })

    if (!logo) {
      return res.status(404).json({
        message: 'Logo not found. Create it first.',
      })
    }

    const { imageUrl, altText } = req.body

    if (imageUrl !== undefined) {
      if (!imageUrl.trim()) {
        return res.status(400).json({
          message: 'Logo image URL cannot be empty',
        })
      }

      logo.imageUrl = imageUrl.trim()
    }

    if (altText !== undefined) {
      logo.altText = altText.trim()
    }

    logo.updatedBy = req.user?._id || null

    const updatedLogo = await logo.save()

    res.json(updatedLogo)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}

// Create the logo if it doesn't exist, or update it if it does
export const saveLogo = async (req, res) => {
  try {
    const { imageUrl, altText } = req.body

    if (!imageUrl || !imageUrl.trim()) {
      return res.status(400).json({
        message: 'Logo image URL is required',
      })
    }

    const logo = await Logo.findOneAndUpdate(
      { name: 'main' },
      {
        $set: {
          imageUrl: imageUrl.trim(),
          altText: altText?.trim() || 'Abuja Store Logo',
          updatedBy: req.user?._id || null,
        },
        $setOnInsert: {
          name: 'main',
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    )

    res.json(logo)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}
