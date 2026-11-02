import mongoose from 'mongoose'

const pageSchema = new mongoose.Schema(
  {
    // The web address: slug "refund-policy" lives at /refund-policy
    slug: {
      type: String,
      required: true,
      unique: true,
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

const Page = mongoose.model('Page', pageSchema)
export default Page