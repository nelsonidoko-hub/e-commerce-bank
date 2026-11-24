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
    status: { type: String, enum: ['draft', 'review', 'published', 'hidden'], default: 'draft' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByName: { type: String, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

export default mongoose.model('StudioTemplate', studioTemplateSchema)
