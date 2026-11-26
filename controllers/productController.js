import { unmarkSample } from '../utils/sampleData.js'
import Product from '../models/Product.js'
import Category from '../models/Category.js'
import { escapeRegex } from '../utils/validate.js'
import { inStore, cleanBody } from '../utils/tenant.js'
import { planFor } from '../utils/plans.js'
import mongoose from 'mongoose'

// A product in this shop, or null. Bad ids count as "not found", not a crash.
function findProduct(req) {
  if (!mongoose.isValidObjectId(req.params.id)) return null
  return Product.findOne(inStore(req, { _id: req.params.id }))
}

export const getProducts = async (req, res) => {
  try {
    const products = await Product.find(inStore(req))
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const getProductById = async (req, res) => {
  try {
    const product = await findProduct(req)

    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    res.json(product)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const getProductsByCategory = async (req, res) => {
  try {
    const categoryName = req.params.categoryName.toLowerCase()

    // If this category has children in the Category collection (e.g.
    // "accessories" is the parent of "sunglasses", "watches", etc.),
    // pull products from the parent AND all of its children.
    // This replaces the old hardcoded ACCESSORY_SUBTYPES array — any
    // subcategory added later through the admin panel is picked up
    // automatically, no code change needed.
    const children = await Category.find(inStore(req, { parent: categoryName })).select('name -_id')
    const childNames = children.map((c) => c.name)

    const namesToMatch = [categoryName, ...childNames]

    // Case-insensitive exact match, tolerant of hyphen vs space
    // (e.g. "school-bags" vs "school bags").
    const orConditions = namesToMatch.map((name) => {
      const normalized = escapeRegex(name.replace(/-/g, ' '))
      return { category: { $regex: `^${normalized}$`, $options: 'i' } }
    })

    const products = await Product.find(inStore(req, { $or: orConditions }))
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const getBestSellers = async (req, res) => {
  try {
    const products = await Product.find(inStore(req, { bestSeller: true }))
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const createProduct = async (req, res) => {
  try {
    // Basic shops have a product limit (BASIC_PRODUCT_LIMIT on the server)
    const { productLimit, name: planName } = planFor(req.store)
    if (Number.isFinite(productLimit)) {
      const count = await Product.countDocuments(inStore(req))
      if (count >= productLimit) {
        return res.status(403).json({
          message: `Your ${planName} plan allows up to ${productLimit} products. Upgrade to Pro for unlimited products.`,
          code: 'PLAN_LIMIT',
        })
      }
    }

    const product = new Product({ ...cleanBody(req.body), store: req.store._id })
    const createdProduct = await product.save()
    res.status(201).json(createdProduct)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}

export const updateProduct = async (req, res) => {
  try {
    const product = await findProduct(req)

    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    Object.assign(product, cleanBody(req.body))
    // A sample the merchant has edited and saved is theirs now
    if (product.isSample) {
      product.isSample = false
      product.image = unmarkSample(product.image)
      if (product.hoverImage) product.hoverImage = unmarkSample(product.hoverImage)
      if (Array.isArray(product.images)) product.images = product.images.map(unmarkSample)
    }
    const updatedProduct = await product.save()

    res.json(updatedProduct)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}

export const deleteProduct = async (req, res) => {
  try {
    const product = await findProduct(req)

    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    await Product.deleteOne(inStore(req, { _id: product._id }))

    res.json({ message: 'Product removed' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const searchProducts = async (req, res) => {
  try {
    // Only plain text is accepted (a repeated ?q= would arrive as a list), and
    // it is escaped so it can never act as a regular expression.
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''

    if (!q) {
      return res.json([])
    }

    const pattern = escapeRegex(q)

    const products = await Product.find(
      inStore(req, {
        $or: [
          { name: { $regex: pattern, $options: 'i' } },
          { description: { $regex: pattern, $options: 'i' } },
          { category: { $regex: pattern, $options: 'i' } },
        ],
      })
    )

    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}