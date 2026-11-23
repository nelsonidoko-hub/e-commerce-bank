import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    // The shop a customer account belongs to. Empty for merchant accounts,
    // which belong to the platform and can own shops.
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', default: null, immutable: true },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      // customer   shops at one store (store is set)
      // merchant   runs shops (store is empty); which shops: Store.owner / Store.staff
      // superadmin the platform owner (store is empty)
      enum: ['customer', 'merchant', 'superadmin'],
      default: 'customer',
    },
    resetToken: String,
    resetTokenExpires: Date,
    // Set whenever the password changes. Login tokens issued before this
    // moment stop working, so a reset signs out anyone who had the old password.
    passwordChangedAt: Date,
  },
  { timestamps: true }
)

userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return
  }

  const salt = await bcrypt.genSalt(10)
  this.password = await bcrypt.hash(this.password, salt)

  // A brand-new account has no earlier tokens to cancel
  if (!this.isNew) {
    this.passwordChangedAt = new Date()
  }
})

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password)
}

// One account per email per shop, plus one platform account per email.
// (Unique on store + email: merchant accounts all have store = null.)
userSchema.index({ store: 1, email: 1 }, { unique: true })

const User = mongoose.model('User', userSchema)

export default User