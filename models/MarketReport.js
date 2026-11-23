import mongoose from 'mongoose'

// A shopper flagged a Market Square listing. The founder sees these on the
// shop's page in the Founder dashboard. Platform-wide, so no tenant plugin.
const marketReportSchema = new mongoose.Schema(
  {
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    storeName: { type: String, default: '' },
    product: { type: mongoose.Schema.Types.ObjectId, required: true },
    productName: { type: String, default: '' },
    reason: { type: String, enum: ['fake', 'scam', 'offensive', 'wrong-info', 'other'], required: true },
    details: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
  },
  { timestamps: true }
)
marketReportSchema.index({ status: 1, createdAt: -1 })

export default mongoose.model('MarketReport', marketReportSchema)
