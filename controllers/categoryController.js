import Category from '../models/Category.js'
import { inStore, byId } from '../utils/tenant.js'

const text = (v) => (typeof v === 'string' ? v : '')

// Returns top-level categories, each with its children nested under it —
// ready to drop straight into a navbar or a grouped <select>.
export const getCategories = async (req, res) => {
  try {
    const all = await Category.find(inStore(req)).sort({ label: 1 })

    const topLevel = all.filter((c) => !c.parent)
    const tree = topLevel.map((parent) => ({
      _id: parent._id,
      name: parent.name,
      label: parent.label,
      children: all
        .filter((c) => c.parent === parent.name)
        .map((child) => ({ _id: child._id, name: child.name, label: child.label })),
    }))

    res.json(tree)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

// Flat list — useful for an admin table or a simple dropdown of all categories.
export const getFlatCategories = async (req, res) => {
  try {
    const categories = await Category.find(inStore(req)).sort({ label: 1 })
    res.json(categories)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const createCategory = async (req, res) => {
  try {
    const name = text(req.body.name)
    const label = text(req.body.label)
    const parent = text(req.body.parent)

    if (!name.trim() || !label.trim()) {
      return res.status(400).json({ message: 'name and label are required' })
    }

    // If a parent is given, it must already exist as a top-level category
    if (parent) {
      const parentExists = await Category.findOne(inStore(req, { name: parent.toLowerCase().trim(), parent: null }))
      if (!parentExists) {
        return res.status(400).json({ message: `Parent category "${parent}" does not exist` })
      }
    }

    const category = await Category.create({
      store: req.store._id,
      name: name.toLowerCase().trim(),
      label: label.trim(),
      parent: parent ? parent.toLowerCase().trim() : null,
    })

    res.status(201).json(category)
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A category with that name already exists' })
    }
    res.status(400).json({ message: error.message })
  }
}

export const updateCategory = async (req, res) => {
  try {
    const category = await Category.findOne(byId(req))
    if (!category) {
      return res.status(404).json({ message: 'Category not found' })
    }

    const name = text(req.body.name)
    const label = text(req.body.label)
    const parent = req.body.parent === undefined ? undefined : text(req.body.parent)
    if (name) category.name = name.toLowerCase().trim()
    if (label) category.label = label.trim()
    if (parent !== undefined) category.parent = parent ? parent.toLowerCase().trim() : null

    const updated = await category.save()
    res.json(updated)
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A category with that name already exists' })
    }
    res.status(400).json({ message: error.message })
  }
}

export const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findOne(byId(req))
    if (!category) {
      return res.status(404).json({ message: 'Category not found' })
    }

    // If this is a parent, don't orphan its children silently — block the delete instead.
    const childCount = await Category.countDocuments(inStore(req, { parent: category.name }))
    if (childCount > 0) {
      return res.status(400).json({
        message: `Cannot delete "${category.label}" — it still has ${childCount} subcategory(ies). Delete or reassign them first.`,
      })
    }

    await Category.deleteOne(byId(req, category._id))
    res.json({ message: 'Category removed' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}