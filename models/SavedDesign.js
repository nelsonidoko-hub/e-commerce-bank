import mongoose from 'mongoose'

// A merchant's own template: a design (theme + homepage sections) saved from
// one of their shops, to reuse on that shop later or to start another shop.
// Belongs to the merchant, not to a shop, so every query filters by owner.
const savedDesignSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    theme: { type: mongoose.Schema.Types.Mixed, default: {} },
    homeSections: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // which shop it was saved from, for the list ("from Amaka's Kitchen")
    fromStoreName: { type: String, default: '' },
  },
  { timestamps: true }
)

savedDesignSchema.index({ owner: 1, name: 1 }, { unique: true })

const SavedDesign = mongoose.model('SavedDesign', savedDesignSchema)
export default SavedDesign
