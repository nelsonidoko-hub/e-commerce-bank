
import mongoose from 'mongoose'

const logoSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: 'main',
      unique: true,
      required: true,
    },

    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },

    altText: {
      type: String,
      default: 'Abuja Store Logo',
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

const Logo = mongoose.model('Logo', logoSchema)

export default Logo