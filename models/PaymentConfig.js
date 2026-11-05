import mongoose from 'mongoose'

// One record for the whole store. The keys are saved ENCRYPTED (see
// utils/secretBox.js), never as plain text, and this model is never sent to
// the browser. Only the last 4 characters are kept readable, for display.
const paymentConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'paystack', unique: true },

    // Which key customers are charged with right now
    mode: { type: String, enum: ['test', 'live'], default: 'test' },

    testSecretEnc: { type: String, default: '' },
    testLast4: { type: String, default: '' },

    liveSecretEnc: { type: String, default: '' },
    liveLast4: { type: String, default: '' },

    // Who last changed the keys
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
)

const PaymentConfig = mongoose.model('PaymentConfig', paymentConfigSchema)
export default PaymentConfig