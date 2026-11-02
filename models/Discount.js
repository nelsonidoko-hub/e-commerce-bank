import mongoose from 'mongoose'

const discountSchema = new mongoose.Schema(
  {
    // What the customer types, always stored in capitals, e.g. "WELCOME10"
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: { type: String, default: '', trim: true },

    // Named discountType (not "type") because Mongoose treats a key called
    // "type" as special, which caused trouble earlier with the order address.
    discountType: {
      type: String,
      enum: ['percent', 'fixed'],
      default: 'percent',
    },
    // percent: 10 means 10% off. fixed: 2000 means ₦2,000 off.
    value: { type: Number, required: true, min: 0 },

    // Cart subtotal needed before the code works. 0 = no minimum.
    minOrder: { type: Number, default: 0, min: 0 },
    // Percent codes only: the most this code can ever take off. 0 = no cap.
    maxDiscount: { type: Number, default: 0, min: 0 },

    // Total times the code can be used. 0 = unlimited.
    usageLimit: { type: Number, default: 0, min: 0 },
    // If true, each customer can only use it once.
    oncePerCustomer: { type: Boolean, default: false },

    // Last moment the code works. null = never expires.
    expiresAt: { type: Date, default: null },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
)

const Discount = mongoose.model('Discount', discountSchema)
export default Discount