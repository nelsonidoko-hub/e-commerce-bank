import mongoose from 'mongoose'

// A record of everything done from the founder dashboard: who did what to
// which shop, and when. Never edited or deleted by the app.
const platformActionSchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    byEmail: { type: String, default: '' },
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', index: true },
    storeName: { type: String, default: '' },
    action: { type: String, required: true },
    details: { type: String, default: '' },
  },
  { timestamps: true }
)

platformActionSchema.index({ createdAt: -1 })

const PlatformAction = mongoose.model('PlatformAction', platformActionSchema)
export default PlatformAction
