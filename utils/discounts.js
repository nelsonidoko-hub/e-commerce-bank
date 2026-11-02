import Discount from '../models/Discount.js'
import Order from '../models/Order.js'

// Errors that are safe to show the customer as-is
export class DiscountError extends Error {}

// Cancelled and expired orders don't count towards usage, so a code is
// "given back" automatically when an unpaid order times out.
const COUNTS_AS_USED = { $ne: 'cancelled' }

// Checks a code against the rules and works out how much it takes off.
// Used both for the preview at checkout and again when the order is created,
// so the amount charged is always decided on the server.
export async function applyDiscount(rawCode, subtotal, userId) {
  const code = String(rawCode || '').trim().toUpperCase()
  if (!code) throw new DiscountError('Enter a discount code')

  const discount = await Discount.findOne({ code })
  if (!discount || !discount.active) {
    throw new DiscountError('That discount code is not valid')
  }

  if (discount.expiresAt && discount.expiresAt < new Date()) {
    throw new DiscountError('This discount code has expired')
  }

  if (subtotal < discount.minOrder) {
    throw new DiscountError(`Spend ₦${discount.minOrder.toLocaleString()} or more to use this code`)
  }

  if (discount.usageLimit > 0) {
    const used = await Order.countDocuments({ discountCode: code, status: COUNTS_AS_USED })
    if (used >= discount.usageLimit) {
      throw new DiscountError('This discount code has been fully used')
    }
  }

  if (discount.oncePerCustomer && userId) {
    const alreadyUsed = await Order.exists({
      user: userId,
      discountCode: code,
      status: COUNTS_AS_USED,
    })
    if (alreadyUsed) {
      throw new DiscountError('You have already used this discount code')
    }
  }

  let amount =
    discount.discountType === 'percent'
      ? Math.round((subtotal * discount.value) / 100)
      : discount.value

  if (discount.discountType === 'percent' && discount.maxDiscount > 0) {
    amount = Math.min(amount, discount.maxDiscount)
  }

  // A discount can never be more than the goods cost
  amount = Math.min(Math.round(amount), subtotal)

  return { discount, amount }
}