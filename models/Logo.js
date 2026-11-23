
import mongoose from 'mongoose'
import { tenantPlugin } from '../utils/tenant.js'

const logoSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: 'main',
      required: true,
    },

    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },

    altText: {
      type: String,
      default: 'Store logo',
      trim: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
)

// Belongs to one shop, and every query must say which (see utils/tenant.js)
logoSchema.plugin(tenantPlugin)
logoSchema.index({ store: 1, name: 1 }, { unique: true })

const Logo = mongoose.model('Logo', logoSchema)

export default Logo