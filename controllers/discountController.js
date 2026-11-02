import Discount from '../models/Discount.js'
import Order from '../models/Order.js'
import { applyDiscount, DiscountError } from '../utils/discounts.js'

const CODE_PATTERN = /^[A-Z0-9_-]{3,30}$/

// Validates what the admin form sent and returns clean data to save.
// requireAll = true when creating, so the essentials must be present.
function cleanFields(body, requireAll) {
  const data = {}

  if (requireAll || body.code !== undefined) {
    const code = String(body.code || '').trim().toUpperCase()
    if (!CODE_PATTERN.test(code)) {
      return { error: 'Code must be 3 to 30 letters, numbers, dashes or underscores' }
    }
    data.code = code
  }

  if (requireAll || body.discountType !== undefined) {
    if (!['percent', 'fixed'].includes(body.discountType)) {
      return { error: 'Choose percentage or fixed amount' }
    }
    data.discountType = body.discountType
  }

  if (requireAll || body.value !== undefined) {
    const value = Number(body.value)
    if (!(value > 0)) return { error: 'The discount must be more than 0' }
    data.value = value
  }

  for (const field of ['minOrder', 'maxDiscount', 'usageLimit']) {
    if (body[field] !== undefined) {
      const n = Number(body[field] || 0)
      if (Number.isNaN(n) || n < 0) return { error: `${field} must be 0 or more` }
      data[field] = n
    }
  }

  if (body.oncePerCustomer !== undefined) data.oncePerCustomer = Boolean(body.oncePerCustomer)
  if (body.active !== undefined) data.active = Boolean(body.active)
  if (body.description !== undefined) data.description = String(body.description).trim()

  if (body.expiresAt !== undefined) {
    if (!body.expiresAt) {
      data.expiresAt = null
    } else {
      const date = new Date(body.expiresAt)
      if (Number.isNaN(date.getTime())) return { error: 'That expiry date is not valid' }
      // A date means "valid through the end of that day"
      date.setUTCHours(23, 59, 59, 999)
      data.expiresAt = date
    }
  }

  return { data }
}

// Admin: every code, with how many times each has been used
export const getDiscounts = async (req, res) => {
  try {
    const discounts = await Discount.find().sort({ createdAt: -1 })

    const usage = await Order.aggregate([
      {
        $match: {
          discountCode: { $in: discounts.map((d) => d.code) },
          status: { $ne: 'cancelled' },
        },
      },
      { $group: { _id: '$discountCode', count: { $sum: 1 } } },
    ])
    const usedByCode = Object.fromEntries(usage.map((u) => [u._id, u.count]))

    res.json(discounts.map((d) => ({ ...d.toObject(), used: usedByCode[d.code] || 0 })))
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const createDiscount = async (req, res) => {
  try {
    const { data, error } = cleanFields(req.body, true)
    if (error) return res.status(400).json({ message: error })

    if (data.discountType === 'percent' && data.value > 100) {
      return res.status(400).json({ message: 'A percentage cannot be more than 100' })
    }

    const discount = await Discount.create(data)
    res.status(201).json(discount)
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A discount with that code already exists' })
    }
    res.status(400).json({ message: error.message })
  }
}

export const updateDiscount = async (req, res) => {
  try {
    const discount = await Discount.findById(req.params.id)
    if (!discount) return res.status(404).json({ message: 'Discount not found' })

    const { data, error } = cleanFields(req.body, false)
    if (error) return res.status(400).json({ message: error })

    Object.assign(discount, data)

    if (discount.discountType === 'percent' && discount.value > 100) {
      return res.status(400).json({ message: 'A percentage cannot be more than 100' })
    }

    const updated = await discount.save()
    res.json(updated)
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'A discount with that code already exists' })
    }
    res.status(400).json({ message: error.message })
  }
}

// Orders keep the code text they used, so deleting a code never breaks old orders
export const deleteDiscount = async (req, res) => {
  try {
    const discount = await Discount.findById(req.params.id)
    if (!discount) return res.status(404).json({ message: 'Discount not found' })

    await discount.deleteOne()
    res.json({ message: 'Discount removed' })
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

// Customer: checks a code at checkout and says how much it would take off.
// This is only a preview. The real amount is worked out again when the
// order is created.
export const validateDiscountCode = async (req, res) => {
  try {
    const { code, subtotal } = req.body
    const { discount, amount } = await applyDiscount(code, Number(subtotal) || 0, req.user._id)

    res.json({
      code: discount.code,
      amount,
      description: discount.description,
    })
  } catch (error) {
    if (error instanceof DiscountError) {
      return res.status(400).json({ message: error.message })
    }
    res.status(500).json({ message: error.message })
  }
}