import Logo from '../models/Logo.js'
import { inStore, upsertSafely } from '../utils/tenant.js'

// Get the store logo
export const getLogo = async (req, res) => {
  try {
    const logo = await Logo.findOne(inStore(req, { name: 'main' }))

    // No logo yet is normal for a new shop, not an error
    res.json(logo || null)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

// Create the store logo
export const createLogo = async (req, res) => {
  try {
    const imageUrl = typeof req.body.imageUrl === 'string' ? req.body.imageUrl : undefined
    const altText = typeof req.body.altText === 'string' ? req.body.altText : undefined

    if (!imageUrl) {
      return res.status(400).json({
        message: 'Logo image URL is required',
      })
    }

    // Only one main logo is allowed
    const existingLogo = await Logo.findOne(inStore(req, { name: 'main' }))

    if (existingLogo) {
      return res.status(400).json({
        message: 'A store logo already exists. Update it instead.',
      })
    }

    const logo = await Logo.create({
      store: req.store._id,
      name: 'main',
      imageUrl: imageUrl.trim(),
      altText: altText?.trim() || `${req.store.name} logo`,
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
    const logo = await Logo.findOne(inStore(req, { name: 'main' }))

    if (!logo) {
      return res.status(404).json({
        message: 'Logo not found. Create it first.',
      })
    }

    const imageUrl = typeof req.body.imageUrl === 'string' ? req.body.imageUrl : undefined
    const altText = typeof req.body.altText === 'string' ? req.body.altText : undefined

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
    const imageUrl = typeof req.body.imageUrl === 'string' ? req.body.imageUrl : undefined
    const altText = typeof req.body.altText === 'string' ? req.body.altText : undefined

    if (!imageUrl || !imageUrl.trim()) {
      return res.status(400).json({
        message: 'Logo image URL is required',
      })
    }

    const logo = await upsertSafely(() =>
      Logo.findOneAndUpdate(
        inStore(req, { name: 'main' }),
        {
          $set: {
            imageUrl: imageUrl.trim(),
            altText: altText?.trim() || `${req.store.name} logo`,
            updatedBy: req.user?._id || null,
          },
        },
        {
          returnDocument: 'after',
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      )
    )

    res.json(logo)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}
