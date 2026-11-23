import mongoose from 'mongoose'

// One subscription payment from a merchant to the platform (not a customer
// order). Created as "pending" before Paystack is asked, so the amount and
// shop are fixed on our side and can't be changed by the browser.
const billingPaymentSchema = new mongoose.Schema(
  {
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    reference: { type: String, required: true, unique: true },
    // gift = free months given from the founder dashboard (amount 0)
    kind: { type: String, enum: ['subscribe', 'renewal', 'upgrade', 'gift'], required: true },
    plan: { type: String, enum: ['basic', 'pro'], required: true },
    amount: { type: Number, required: true }, // Naira
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending', index: true },
    failureReason: { type: String, default: '' },
    paidAt: Date,
    // the shop's paid-until date after this payment
    periodEnd: Date,
  },
  { timestamps: true }
)

billingPaymentSchema.index({ store: 1, createdAt: -1 })

const BillingPayment = mongoose.model('BillingPayment', billingPaymentSchema)
export default BillingPayment
