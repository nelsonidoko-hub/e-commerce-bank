import mongoose from 'mongoose'
import { tenantPlugin } from '../utils/tenant.js'

const pageSchema = new mongoose.Schema(
  {
    // The web address: slug "refund-policy" lives at /refund-policy
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    title: { type: String, required: true, trim: true },

    // Plain text. Blank line = new paragraph, "## " starts a heading,
    // "- " starts a bullet. Rendered safely, so no HTML is ever stored.
    content: { type: String, default: '' },

    // Where the footer links to this page from
    footerColumn: {
      type: String,
      enum: ['resources', 'support', 'none'],
      default: 'none',
    },

    // Unpublished pages show as "not found" to customers
    published: { type: Boolean, default: true },

    // Position within its footer column, lowest first
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
)

// Belongs to one shop, and every query must say which (see utils/tenant.js)
pageSchema.plugin(tenantPlugin)
pageSchema.index({ store: 1, slug: 1 }, { unique: true })
const Page = mongoose.model('Page', pageSchema)
export default Page