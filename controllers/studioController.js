import StudioTemplate from '../models/StudioTemplate.js'
import Settings from '../models/Settings.js'
import Store from '../models/Store.js'
import { cleanKey, cleanRecipe, cleanPictures, cleanSamples, cleanEmails, refreshTemplates, TemplateError, SAMPLE_SETS, PARTS, BUILTIN_TEMPLATES } from '../utils/templates.js'
import { SAMPLE_PRODUCT_NAMES } from '../utils/sampleData.js'
import cloudinary from '../config/cloudinary.js'
import { remakeDemo } from '../scripts/seedDemos.js'
import { storeUrl } from '../utils/storeUrl.js'

// The Template Studio: the founder and team members marked as designers make
// new templates from the storefront's parts, without code.
//   designers: create, edit, send for review
//   founder:   all of that, plus publish (goes into the gallery) and hide

const isFounder = (user) => user?.role === 'superadmin'

export const studioAccess = (req, res, next) => {
  if (isFounder(req.user) || req.user?.designer) return next()
  res.status(403).json({ message: 'The Template Studio is for the platform team' })
}

function serverError(res, error, where) {
  if (error instanceof TemplateError) return res.status(400).json({ message: error.message })
  if (error?.code === 11000) return res.status(400).json({ message: 'That short name is taken' })
  console.error(`${where}:`, error)
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

// The template id shops store: the built-in's id for an edited built-in
const templateId = (t) => t.builtIn || t.key

// How many shops (not demos) wear this template right now
async function shopsUsing(key) {
  const settings = await Settings.find({ 'theme.template': key }).setOptions({ allStores: true }).select('store').lean()
  if (!settings.length) return 0
  return Store.countDocuments({ _id: { $in: settings.map((s) => s.store) }, isDemo: { $ne: true } })
}

async function view(t) {
  const demo = t.status === 'published' ? await Store.findOne({ slug: `demo-${templateId(t)}` }).select('slug customDomain customDomainVerified').lean() : null
  return {
    _id: t._id,
    key: t.key,
    label: t.label,
    bestFor: t.bestFor,
    description: t.description,
    sampleSet: t.sampleSet,
    recipe: t.recipe,
    pictures: t.pictures || {},
    samples: t.samples || null,
    visibility: t.visibility || 'public',
    allowedEmails: t.allowedEmails || [],
    builtIn: t.builtIn || '',
    status: t.status,
    createdByName: t.createdByName,
    updatedAt: t.updatedAt,
    publishedAt: t.publishedAt,
    shops: await shopsUsing(templateId(t)),
    demoUrl: demo ? storeUrl(demo) : null,
  }
}

// GET /api/studio/options -> the parts to choose from
export const studioOptions = (req, res) => {
  res.json({ parts: PARTS, sampleSets: SAMPLE_SETS, sampleProducts: SAMPLE_PRODUCT_NAMES, builtIn: BUILTIN_TEMPLATES, canPublish: isFounder(req.user) })
}

// GET /api/studio
export const listStudio = async (req, res) => {
  try {
    const all = await StudioTemplate.find({}).sort({ updatedAt: -1 }).lean()
    res.json({ templates: await Promise.all(all.map(view)), canPublish: isFounder(req.user) })
  } catch (error) {
    serverError(res, error, 'listStudio')
  }
}

// GET /api/studio/:id
export const getStudio = async (req, res) => {
  try {
    const t = await StudioTemplate.findById(req.params.id).lean().catch(() => null)
    if (!t) return res.status(404).json({ message: 'Template not found' })
    res.json(await view(t))
  } catch (error) {
    serverError(res, error, 'getStudio')
  }
}

function details(body) {
  const label = text(body.label, 40)
  if (!label) throw new TemplateError('Give the template a name')
  const sampleSet = SAMPLE_SETS[body.sampleSet] ? body.sampleSet : 'classic'
  return {
    label,
    bestFor: text(body.bestFor, 60),
    description: text(body.description, 240),
    sampleSet,
    recipe: cleanRecipe(body.recipe),
    pictures: cleanPictures(body.pictures, sampleSet),
    samples: sampleSet === 'custom' ? cleanSamples(body.samples) : null,
    // Edited built-ins are always public (they replace a gallery template)
    visibility: body.visibility === 'private' && !body.builtIn ? 'private' : 'public',
    allowedEmails: body.visibility === 'private' && !body.builtIn ? cleanEmails(body.allowedEmails) : [],
  }
}

// POST /api/studio  { key, label, bestFor, description, sampleSet, recipe, pictures }
// or, to edit a built-in template: { builtIn: 'fresh', label, ... } (one edited
// version per built-in)
export const createStudio = async (req, res) => {
  try {
    const builtIn = req.body?.builtIn
    if (builtIn !== undefined && builtIn !== '' && !BUILTIN_TEMPLATES.includes(builtIn)) return res.status(400).json({ message: 'Unknown built-in template' })
    if (builtIn && (await StudioTemplate.exists({ builtIn }))) return res.status(400).json({ message: 'This template already has an edited version. Open it from the Studio.' })
    const key = builtIn ? `builtin-${builtIn}` : cleanKey(req.body?.key)
    const t = await StudioTemplate.create({
      key,
      builtIn: builtIn || '',
      ...details({ ...(req.body || {}), builtIn }),
      createdBy: req.user._id,
      createdByName: req.user.name,
      updatedBy: req.user._id,
    })
    await refreshTemplates()
    res.status(201).json(await view(t.toObject()))
  } catch (error) {
    serverError(res, error, 'createStudio')
  }
}

// PUT /api/studio/:id  (the short name can't change: shops refer to it)
// Changing a published template changes every shop wearing it, which is how
// a fix reaches everyone at once.
export const updateStudio = async (req, res) => {
  try {
    const t = await StudioTemplate.findById(req.params.id).catch(() => null)
    if (!t) return res.status(404).json({ message: 'Template not found' })
    if (t.status === 'published' && !isFounder(req.user)) {
      return res.status(403).json({ message: 'Only the founder can change a published template' })
    }
    Object.assign(t, details({ ...(req.body || {}), builtIn: t.builtIn }), { updatedBy: req.user._id })
    t.markModified('recipe')
    t.markModified('pictures')
    t.markModified('samples')
    await t.save()
    await refreshTemplates()
    // Live in the gallery: rebuild its demo shop so it shows the change now
    if (t.status === 'published' && t.visibility !== 'private') await remakeDemo(req.user, templateId(t), `${t.label} demo`)
    res.json(await view(t.toObject()))
  } catch (error) {
    serverError(res, error, 'updateStudio')
  }
}

// POST /api/studio/:id/status  { status: review | draft | published | hidden }
export const setStudioStatus = async (req, res) => {
  try {
    const t = await StudioTemplate.findById(req.params.id).catch(() => null)
    if (!t) return res.status(404).json({ message: 'Template not found' })
    const next = req.body?.status
    const founderOnly = next === 'published' || next === 'hidden'
    if (!['review', 'draft', 'published', 'hidden'].includes(next)) return res.status(400).json({ message: 'Unknown status' })
    if (founderOnly && !isFounder(req.user)) return res.status(403).json({ message: 'Only the founder can publish or hide templates' })
    if (!founderOnly && ['published', 'hidden'].includes(t.status) && !isFounder(req.user)) {
      return res.status(403).json({ message: 'Only the founder can change a published template' })
    }
    if (!t.builtIn && next === 'draft' && ['published', 'hidden'].includes(t.status) && (await shopsUsing(t.key)) > 0) {
      return res.status(400).json({ message: 'Shops are using this template. Hide it instead.' })
    }
    const wasPublished = t.status === 'published'
    t.status = next
    if (next === 'published' && !t.publishedAt) t.publishedAt = new Date()
    t.updatedBy = req.user._id
    await t.save()
    await refreshTemplates()
    // A fresh demo shop on every publish, so "View demo" shows the latest
    // (private templates get no public demo shop)
    if (next === 'published' && t.visibility !== 'private') await remakeDemo(req.user, templateId(t), `${t.label} demo`)
    // an edited built-in taken off: its demo goes back to the original look
    else if (t.builtIn && wasPublished) await remakeDemo(req.user, t.builtIn, `${t.label} demo`)
    res.json(await view(t.toObject()))
  } catch (error) {
    serverError(res, error, 'setStudioStatus')
  }
}

// DELETE /api/studio/:id  (only if no shop uses it)
export const deleteStudio = async (req, res) => {
  try {
    const t = await StudioTemplate.findById(req.params.id).catch(() => null)
    if (!t) return res.status(404).json({ message: 'Template not found' })
    // An edited built-in can always go ("Reset to original"): shops fall back
    // to the original look. The founder decides once it has been live.
    if (t.builtIn) {
      if (['published', 'hidden'].includes(t.status) && !isFounder(req.user)) return res.status(403).json({ message: 'Only the founder can reset this template' })
      await StudioTemplate.deleteOne({ _id: t._id })
      await refreshTemplates()
      if (t.status === 'published') await remakeDemo(req.user, t.builtIn, `${t.label} demo`)
      return res.json({ message: 'Back to the original' })
    }
    if (t.status === 'published') return res.status(400).json({ message: 'Hide it first' })
    if (['hidden'].includes(t.status) && !isFounder(req.user)) return res.status(403).json({ message: 'Only the founder can delete this' })
    if ((await shopsUsing(t.key)) > 0) return res.status(400).json({ message: 'Shops are using this template, so it stays. You can keep it hidden.' })
    await StudioTemplate.deleteOne({ _id: t._id })
    await refreshTemplates()
    res.json({ message: 'Deleted' })
  } catch (error) {
    serverError(res, error, 'deleteStudio')
  }
}

// POST /api/studio/upload  (multipart "image") -> { url }
// Photos for templates. Use your own photos, or free-licence stock photos
// (e.g. Unsplash, Pexels) - never pictures copied from other shops or Google.
export const uploadStudioPicture = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Choose a picture to upload' })
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder: 'platform/templates' }, (error, out) => (error ? reject(error) : resolve(out)))
      stream.end(req.file.buffer)
    })
    res.json({ url: result.secure_url })
  } catch (error) {
    console.error('uploadStudioPicture:', error)
    res.status(500).json({ message: 'Upload failed. Please try again.' })
  }
}
