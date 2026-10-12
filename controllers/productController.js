import Product from '../models/Product.js'
import Category from '../models/Category.js'

export const getProducts = async (req, res) => {
  try {
    const products = await Product.find()
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)

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
    const children = await Category.find({ parent: categoryName }).select('name -_id')
    const childNames = children.map((c) => c.name)

    const namesToMatch = [categoryName, ...childNames]

    // Case-insensitive exact match, tolerant of hyphen vs space
    // (e.g. "school-bags" vs "school bags").
    const orConditions = namesToMatch.map((name) => {
      const normalized = name.replace(/-/g, ' ')
      return { category: { $regex: `^${normalized}$`, $options: 'i' } }
    })

    const products = await Product.find({ $or: orConditions })
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const getBestSellers = async (req, res) => {
  try {
    const products = await Product.find({ bestSeller: true })
    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const createProduct = async (req, res) => {
  try {
    const product = new Product(req.body)
    const createdProduct = await product.save()
    res.status(201).json(createdProduct)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}

export const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)

    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    Object.assign(product, req.body)
    const updatedProduct = await product.save()

    res.json(updatedProduct)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}

export const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)

    if (!product) {
      return res.status(404).json({ message: 'Product not found' })
    }

    await product.deleteOne()

    res.json({ message: 'Product removed' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const searchProducts = async (req, res) => {
  try {
    const { q } = req.query

    if (!q) {
      return res.json([])
    }

    const products = await Product.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { category: { $regex: q, $options: 'i' } },
      ],
    })

    res.json(products)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}