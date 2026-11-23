import mongoose from 'mongoose'
import { tenantPlugin } from '../utils/tenant.js'

const heroSlideSchema = new mongoose.Schema(
  {
    // What kind of media this slide shows
    mediaType: {
      type: String,
      enum: ['image', 'video'],
      default: 'image',
    },
    // URL of the uploaded file (or a pasted link)
    mediaUrl: { type: String, required: true, trim: true },

    heading: { type: String, default: '', trim: true },
    text: { type: String, default: '', trim: true },

    // Leave buttonLabel empty to hide the button
    buttonLabel: { type: String, default: 'Shop Now', trim: true },
    buttonLink: { type: String, default: '/shop', trim: true },

    // Lower number = shown first
    order: { type: Number, default: 0 },

    // Inactive slides are kept but not shown on the storefront
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

// Belongs to one shop, and every query must say which (see utils/tenant.js)
heroSlideSchema.plugin(tenantPlugin)
heroSlideSchema.index({ store: 1, order: 1 })

const HeroSlide = mongoose.model('HeroSlide', heroSlideSchema)
export default HeroSlide