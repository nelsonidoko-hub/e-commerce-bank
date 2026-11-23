import mongoose from 'mongoose'
import { tenantPlugin } from '../utils/tenant.js'

const categorySchema = new mongoose.Schema(
  {
    // URL-safe identifier, matches what's saved on Product.category
    // e.g. "sunglasses", "school-bags"
    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // Human-readable display name, e.g. "Sunglasses"
    label: {
      type: String,
      required: true,
      trim: true,
    },
    // null/omitted = top-level category (e.g. "accessories")
    // set = this is a subcategory under that parent's "name"
    // (e.g. parent: "accessories" for "sunglasses")
    parent: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
  },
  { timestamps: true }
)

// Belongs to one shop, and every query must say which (see utils/tenant.js)
categorySchema.plugin(tenantPlugin)
categorySchema.index({ store: 1, name: 1 }, { unique: true })

const Category = mongoose.model('Category', categorySchema)
export default Category