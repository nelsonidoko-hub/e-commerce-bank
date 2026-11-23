import mongoose from 'mongoose'

// How many shoppers went from the Market Square to a shop, per shop per day
// ('2026-11-23'). One small document a day per shop, so it never grows big.
const marketClickSchema = new mongoose.Schema({
  store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true },
  day: { type: String, required: true },
  count: { type: Number, default: 0 },
})
marketClickSchema.index({ store: 1, day: 1 }, { unique: true })

export default mongoose.model('MarketClick', marketClickSchema)
