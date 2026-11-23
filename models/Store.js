import mongoose from 'mongoose'

// One merchant's shop on the platform. Every product, order, page, setting and
// customer belongs to exactly one store.
//
// Whether the shop is live is worked out from the dates below (see
// utils/storeAccess.js), so nothing has to run on a timer to switch it off.

// Shop addresses become `<slug>.<PLATFORM_DOMAIN>`, so the slug must be a valid
// single web-address label. Some are kept back for the platform itself.
export const RESERVED_SLUGS = [
  'www', 'api', 'app', 'admin', 'dashboard', 'mail', 'email', 'help', 'support',
  'billing', 'status', 'blog', 'docs', 'store', 'stores', 'shop', 'static', 'cdn',
  'assets', 'login', 'signup', 'register', 'account', 'platform', 'test', 'demo',
]
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/

const storeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: (v) => SLUG_PATTERN.test(v) && !v.includes('--') && !RESERVED_SLUGS.includes(v),
        message: 'Shop address must be 3-40 letters, numbers or dashes',
      },
    },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Extra people who can run the shop's admin (Pro plan)
    staff: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Where new-order and refund alerts go. Set to the owner's email at creation.
    notifyEmail: { type: String, trim: true, lowercase: true, default: '' },

    // Order numbers look like AMA-10001. Empty = first letters of the slug.
    orderPrefix: { type: String, trim: true, uppercase: true, maxlength: 5, match: /^[A-Z0-9]*$/, default: '' },

    plan: { type: String, enum: ['basic', 'pro'], default: 'basic' },

    // Set the first time the merchant publishes. Before that, only they can see it.
    publishedAt: { type: Date, default: null },
    // Free trial of live selling, from first publish
    trialEndsAt: { type: Date, default: null },
    // Paid up until this moment. Billing (Phase 4) moves it forward each month.
    currentPeriodEnd: { type: Date, default: null },
    // Platform owner switched the shop off (abuse, fraud). Overrides everything.
    suspended: { type: Boolean, default: false },
    suspendedReason: { type: String, default: '' },

    // The merchant's own web address (Pro). Only used once verified.
    customDomain: { type: String, trim: true, lowercase: true, default: undefined },
    customDomainVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
)

// Two shops can never claim the same custom domain
storeSchema.index({ customDomain: 1 }, { unique: true, sparse: true })

const Store = mongoose.model('Store', storeSchema)
export default Store
