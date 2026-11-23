import mongoose from 'mongoose'
import { tenantPlugin } from '../utils/tenant.js'

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, required: true },
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
)

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
        name: String,
        image: String,
        price: Number,
        size: String,
        quantity: Number,
      },
    ],
    deliveryMethod: {
      type: String,
      enum: ['ship', 'pickup'],
      default: 'ship',
    },
    shippingAddress: {
      firstName: String,
      lastName: String,
      address: {
        type: String,
        required: function () {
          return this.deliveryMethod !== 'pickup'
        },
      },
      apartment: String,
      city: {
        type: String,
        required: function () {
          return this.deliveryMethod !== 'pickup'
        },
      },
      state: String,
      postalCode: String,
      phone: { type: String, required: true },
      pickupType: String, // e.g. 'Store Pickup'
      location: String, // e.g. 'Main Retail Store Branch'
    },
    // Breakdown saved at checkout. Older orders won't have these.
    subtotal: { type: Number, default: 0 },
    shippingCost: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    // Discount code used on this order, if any (indexed so usage counts are fast)
    discountCode: { type: String, default: '' },
    discountAmount: { type: Number, default: 0 },
    totalPrice: { type: Number, required: true },
    // The customer's own note, e.g. "no pepper". Plain text, escaped wherever shown.
    customerNote: { type: String, default: '', maxlength: 500, trim: true },
    // Placed while the shop was closed and set to take pre-orders
    isPreOrder: { type: Boolean, default: false },
    paymentReference: String,
    isPaid: { type: Boolean, default: false },
    paidAt: Date,
    status: {
      type: String,
      enum: ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
    },
    statusHistory: [statusHistorySchema],
    tracking: {
      // Shipping-only fields
      courier: String,
      trackingNumber: String,
      trackingUrl: String,
      riderPhone: String,
      estimatedDelivery: Date,
      // Pickup-only fields
      readyForPickupAt: Date,
      pickupNote: String,
    },
    deliveredAt: Date,

    expiresAt: Date,
    expiredAt: Date,
  },
  { timestamps: true }
)

// Belongs to one shop, and every query must say which (see utils/tenant.js)
orderSchema.plugin(tenantPlugin)
// Order numbers repeat between shops (each starts at its own 10001)
orderSchema.index({ store: 1, orderNumber: 1 }, { unique: true, partialFilterExpression: { orderNumber: { $type: 'string' } } })
orderSchema.index({ store: 1, createdAt: -1 })
orderSchema.index({ store: 1, discountCode: 1 })
orderSchema.index({ store: 1, user: 1 })
const Order = mongoose.model('Order', orderSchema)
export default Order