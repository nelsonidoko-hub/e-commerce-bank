import mongoose from 'mongoose'
import SavedDesign from '../models/SavedDesign.js'
import { getStoreSettings, cleanTheme } from './settingsController.js'
import { cleanSections, liveSections } from '../utils/sections.js'
import { planFor } from '../utils/plans.js'

// "My templates": designs a merchant saved to reuse. Saving and applying
// need the Pro plan; the list is always visible so merchants can see what
// they'd get. Every query is limited to the signed-in merchant's own designs.
export const MAX_DESIGNS = 20

function serverError(res, error, where) {
  console.error(`${where} error:`, error)
  res.status(500).json({ message: 'Something went wrong' })
}

const summary = (d) => ({
  _id: d._id,
  name: d.name,
  template: d.theme?.template || 'classic',
  sections: (d.homeSections || []).length,
  fromStoreName: d.fromStoreName,
  createdAt: d.createdAt,
})

// Only the merchant's own account, never a customer account
const ownerId = (req) => (req.user && !req.user.store ? req.user._id : null)

// GET /api/designs
export const listDesigns = async (req, res) => {
  try {
    const owner = ownerId(req)
    if (!owner) return res.json([])
    const designs = await SavedDesign.find({ owner }).sort({ createdAt: -1 }).lean()
    res.json(designs.map(summary))
  } catch (error) {
    serverError(res, error, 'listDesigns')
  }
}

// POST /api/designs  { name }: saves the design being edited (draft, or live)
export const saveDesign = async (req, res) => {
  try {
    const owner = ownerId(req)
    if (!owner) return res.status(403).json({ message: 'Only shop owners can save templates' })
    if (!planFor(req.store).ownTemplates) {
      return res.status(403).json({ message: 'Saving your own templates is part of the Pro plan.', code: 'PLAN_LIMIT' })
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : ''
    if (!name) return res.status(400).json({ message: 'Give your template a name' })
    if ((await SavedDesign.countDocuments({ owner })) >= MAX_DESIGNS) {
      return res.status(400).json({ message: `You can save up to ${MAX_DESIGNS} templates. Delete one first.` })
    }

    const settings = await getStoreSettings(req.store)
    const plain = settings.toObject ? settings.toObject() : settings
    const draft = plain.draft
    const theme = cleanTheme({ ...plain.theme, ...(draft?.theme || {}) })
    const homeSections = cleanSections(Array.isArray(draft?.homeSections) ? draft.homeSections : liveSections(plain))

    const design = await SavedDesign.create({ owner, name, theme, homeSections, fromStoreName: req.store.name })
    res.status(201).json(summary(design))
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ message: 'You already have a template with that name' })
    serverError(res, error, 'saveDesign')
  }
}

async function findOwn(req) {
  const owner = ownerId(req)
  if (!owner || !mongoose.isValidObjectId(req.params.id)) return null
  return SavedDesign.findOne({ _id: req.params.id, owner }).lean()
}

// POST /api/designs/:id/apply: loads it into this shop's draft (not live yet)
export const applyDesign = async (req, res) => {
  try {
    if (!planFor(req.store).ownTemplates) {
      return res.status(403).json({ message: 'Using your own templates is part of the Pro plan.', code: 'PLAN_LIMIT' })
    }
    const design = await findOwn(req)
    if (!design) return res.status(404).json({ message: 'Template not found' })

    const settings = await getStoreSettings(req.store)
    settings.draft = {
      theme: cleanTheme(design.theme || {}),
      homeSections: cleanSections(design.homeSections || []),
      updatedAt: new Date(),
    }
    settings.markModified?.('draft')
    await settings.save()
    res.json({ applied: true, name: design.name })
  } catch (error) {
    serverError(res, error, 'applyDesign')
  }
}

// DELETE /api/designs/:id
export const deleteDesign = async (req, res) => {
  try {
    const design = await findOwn(req)
    if (!design) return res.status(404).json({ message: 'Template not found' })
    await SavedDesign.deleteOne({ _id: design._id, owner: design.owner })
    res.json({ deleted: true })
  } catch (error) {
    serverError(res, error, 'deleteDesign')
  }
}
