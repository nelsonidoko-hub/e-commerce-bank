import mongoose from 'mongoose'

// A template made in the Template Studio (no code): a "recipe" of the parts
// the storefront already has. Platform-wide, so no tenant plugin.
//   status: draft (being made) -> review (sent to the founder) -> published
//           (in the gallery) or hidden (out of the gallery; shops already
//           using it keep working)
const studioTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    label: { type: String, required: true, trim: true, maxlength: 40 },
    bestFor: { type: String, trim: true, maxlength: 60, default: '' },
    description: { type: String, trim: true, maxlength: 240, default: '' },
    sampleSet: { type: String, default: 'classic' },
    recipe: { type: mongoose.Schema.Types.Mixed, required: true },
    // Real photos (all optional): { hero, banner, featured, products: { 'Sample name': url } }
    // New shops and the demo shop start with these instead of drawn pictures.
    pictures: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    // Set when this is an edited version of a built-in template (e.g. 'fresh').
    // Published, it replaces the built-in look everywhere; deleting it brings
    // the original back.
    builtIn: { type: String, default: '' },
    // When sampleSet is 'custom': the template's own starter content
    // { heading, text, categories: [{ name, label }], products: [{ name, price, category, description, image }] }
    samples: { type: mongoose.Schema.Types.Mixed, default: null },
    // public: in the gallery for everyone. private: made for particular
    // clients - only these platform accounts (emails) can use it, it never
    // shows in the gallery and has no public demo shop.
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    allowedEmails: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'review', 'published', 'hidden'], default: 'draft' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

export default mongoose.model('StudioTemplate', studioTemplateSchema)
