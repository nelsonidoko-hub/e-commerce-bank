import StudioTemplate from '../models/StudioTemplate.js'
import Settings from '../models/Settings.js'
import Store from '../models/Store.js'
import { cleanKey, cleanRecipe, refreshTemplates, TemplateError, SAMPLE_SETS, PARTS, BUILTIN_TEMPLATES } from '../utils/templates.js'
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

// How many shops (not demos) wear this template right now
async function shopsUsing(key) {
  const settings = await Settings.find({ 'theme.template': key }).setOptions({ allStores: true }).select('store').lean()
  if (!settings.length) return 0
  return Store.countDocuments({ _id: { $in: settings.map((s) => s.store) }, isDemo: { $ne: true } })
}

async function view(t) {
  const demo = t.status === 'published' ? await Store.findOne({ slug: `demo-${t.key}` }).select('slug customDomain customDomainVerified').lean() : null
  return {
    _id: t._id,
    key: t.key,
    label: t.label,
    bestFor: t.bestFor,
    description: t.description,
    sampleSet: t.sampleSet,
    recipe: t.recipe,
    status: t.status,
    createdByName: t.createdByName,
    updatedAt: t.updatedAt,
    publishedAt: t.publishedAt,
    shops: await shopsUsing(t.key),
    demoUrl: demo ? storeUrl(demo) : null,
  }
}

// GET /api/studio/options -> the parts to choose from
export const studioOptions = (req, res) => {
  res.json({ parts: PARTS, sampleSets: SAMPLE_SETS, builtIn: BUILTIN_TEMPLATES, canPublish: isFounder(req.user) })
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
  return { label, bestFor: text(body.bestFor, 60), description: text(body.description, 240), sampleSet, recipe: cleanRecipe(body.recipe) }
}

// POST /api/studio  { key, label, bestFor, description, sampleSet, recipe }
export const createStudio = async (req, res) => {
  try {
    const key = cleanKey(req.body?.key)
    const t = await StudioTemplate.create({
      key,
      ...details(req.body || {}),
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
    Object.assign(t, details(req.body || {}), { updatedBy: req.user._id })
    t.markModified('recipe')
    await t.save()
    await refreshTemplates()
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
    if (next === 'draft' && ['published', 'hidden'].includes(t.status) && (await shopsUsing(t.key)) > 0) {
      return res.status(400).json({ message: 'Shops are using this template. Hide it instead.' })
    }
    t.status = next
    if (next === 'published' && !t.publishedAt) t.publishedAt = new Date()
    t.updatedBy = req.user._id
    await t.save()
    await refreshTemplates()
    // A fresh demo shop on every publish, so "View demo" shows the latest
    if (next === 'published') await remakeDemo(req.user, t.key, `${t.label} demo`)
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
