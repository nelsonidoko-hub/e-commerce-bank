import Order from '../models/Order.js'
import mongoose from 'mongoose'
import { inStore, byId } from '../utils/tenant.js'
import { canManageStore } from '../utils/storeAccess.js'
import Counter from '../models/Counter.js'
import Product from '../models/Product.js'
import { restoreStock } from '../utils/stock.js'
import { sendStatusUpdate, sendPickupReady } from '../utils/email.js'
import { HOLD_MINUTES } from '../utils/expireOrders.js'
import { getStoreSettings } from './settingsController.js'
import { applyDiscount } from '../utils/discounts.js'
import { getOpenStatus } from '../utils/openingHours.js'

const STATUSES = ['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled']
const NOTIFY = ['processing', 'shipped', 'delivered', 'cancelled']
const NEEDS_PAYMENT = ['processing', 'shipped', 'delivered']

// Each shop numbers its own orders from 10001, with a prefix from its address:
// "amaka-styles" gives AMA-10001, unless the shop has its own orderPrefix.
export function orderPrefix(store) {
  if (store.orderPrefix) return store.orderPrefix
  const letters = String(store.slug || '').replace(/[^a-z0-9]/g, '').slice(0, 3).toUpperCase()
  return letters || 'ORD'
}

async function nextOrderNumber(store) {
  const counter = await Counter.findOneAndUpdate(
    { _id: `${store._id}:order` },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true }
  )
  return `${orderPrefix(store)}-${10000 + counter.seq}`
}

export const createOrder = async (req, res) => {
  const reserved = []
  try {
    const { items, shippingAddress, deliveryMethod } = req.body

    // Template demos show the whole shop but never take real orders
    if (req.store.isDemo) {
      return res.status(400).json({ message: 'This is a demo shop, so orders are switched off.', code: 'DEMO_SHOP' })
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Your cart is empty' })
    }

    // Shipping, tax and pickup rules come from the store settings,
    // never from the browser, so the customer is charged what the store decided.
    const settings = await getStoreSettings(req.store)
    const method = deliveryMethod === 'pickup' ? 'pickup' : 'ship'

    if (method === 'pickup' && !settings.pickup.enabled) {
      return res.status(400).json({ message: 'Store pickup is not available right now' })
    }

    // Opening hours: checked here, before any stock is reserved
    const hours = settings.toObject().hours || {}
    const openStatus = getOpenStatus(hours)
    let isPreOrder = false
    if (!openStatus.open) {
      if (hours.whenClosed === 'preorder') {
        isPreOrder = true
      } else {
        const when = openStatus.opensText ? ` We open ${openStatus.opensText}.` : ''
        return res.status(400).json({ message: `Sorry, we're closed right now.${when}`, closed: true })
      }
    }

    const customerNote = typeof req.body.customerNote === 'string' ? req.body.customerNote.trim() : ''
    if (customerNote.length > 500) {
      return res.status(400).json({ message: 'Your note can be up to 500 characters' })
    }

    const orderItems = []

    for (const item of items) {
      const quantity = Number(item.quantity)
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error('Invalid quantity')
      }

      // Check and decrement in one atomic step, so two buyers can't take the last unit
      const product = await Product.findOneAndUpdate(
        {
          // Only this shop's products: a product id from another shop is "not found"
          store: req.store._id,
          _id: mongoose.isValidObjectId(item.product) ? item.product : new mongoose.Types.ObjectId(),
          sizes: { $elemMatch: { size: String(item.size ?? ''), stock: { $gte: quantity } } },
        },
        { $inc: { 'sizes.$.stock': -quantity } },
        { returnDocument: 'after' }
      )

      if (!product) {
        throw new Error(`${item.name || 'An item'} (${item.size}) is out of stock or not enough is left`)
      }

      reserved.push({ product: product._id, size: item.size, quantity })
      orderItems.push({
        product: product._id,
        name: product.name,
        image: product.image,
        price: product.price,
        size: item.size,
        quantity,
      })
    }

    const subtotal = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0)

    let shippingCost = 0
    if (method === 'ship') {
      const threshold = settings.shipping.freeShippingThreshold
      const qualifiesForFree = threshold > 0 && subtotal >= threshold
      shippingCost = qualifiesForFree ? 0 : settings.shipping.flatRate
    }

    // Optional discount code. Checked again here on the server, whatever the
    // browser showed. Tax is worked out on the price after the discount.
    let discountCode = ''
    let discountAmount = 0
    if (req.body.discountCode) {
      const result = await applyDiscount(req.store._id, req.body.discountCode, subtotal, req.user._id)
      discountCode = result.discount.code
      discountAmount = result.amount
    }

    const taxAmount = Math.round(((subtotal - discountAmount) * settings.tax.rate) / 100)
    const totalPrice = subtotal - discountAmount + shippingCost + taxAmount

    // For pickup, the location is the store's own, not whatever the browser sent
    const address =
      method === 'pickup'
        ? {
            pickupType: 'Store Pickup',
            location: settings.pickup.name,
            phone: shippingAddress?.phone,
          }
        : shippingAddress

    const order = await Order.create({
      store: req.store._id,
      orderNumber: await nextOrderNumber(req.store),
      user: req.user._id,
      items: orderItems,
      deliveryMethod: method,
      shippingAddress: address,
      subtotal,
      shippingCost,
      taxAmount,
      discountCode,
      discountAmount,
      totalPrice,
      customerNote,
      isPreOrder,
      statusHistory: [
        { status: 'pending', note: isPreOrder ? 'Pre-order placed while closed' : 'Order placed', at: new Date() },
      ],
      expiresAt: new Date(Date.now() + HOLD_MINUTES * 60 * 1000),
    })

    res.status(201).json(order)
  } catch (error) {
    await restoreStock(req.store._id, reserved).catch(() => {})
    res.status(400).json({ message: error.message })
  }
}

export const getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find(inStore(req, { user: req.user._id })).sort({ createdAt: -1 })
    res.json(orders)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const getOrderById = async (req, res) => {
  try {
    const order = await Order.findOne(byId(req)).populate('user', 'name email')

    if (!order) return res.status(404).json({ message: 'Order not found' })

    if (String(order.user?._id || order.user) !== String(req.user._id) && !canManageStore(req.user, req.store)) {
      return res.status(403).json({ message: 'Not authorized' })
    }

    res.json(order)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find(inStore(req)).populate('user', 'name email').sort({ createdAt: -1 })
    res.json(orders)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const getOrdersByUserId = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) return res.json([])
    const orders = await Order.find(inStore(req, { user: req.params.userId })).sort({ createdAt: -1 })
    res.json(orders)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}

export const updateOrderStatus = async (req, res) => {
  try {
    const { status, note, tracking } = req.body

    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' })
    }

    const order = await Order.findOne(byId(req)).populate('user', 'name email')
    if (!order) return res.status(404).json({ message: 'Order not found' })

    if (order.status === 'cancelled') {
      return res.status(400).json({ message: 'Cancelled orders cannot be changed' })
    }

    if (status && NEEDS_PAYMENT.includes(status) && !order.isPaid) {
      return res.status(400).json({ message: 'This order has not been paid yet' })
    }

    const wasReady = Boolean(order.tracking?.readyForPickupAt)

    if (tracking) {
      for (const key of [
        'courier',
        'trackingNumber',
        'trackingUrl',
        'riderPhone',
        'estimatedDelivery',
        'readyForPickupAt',
        'pickupNote',
      ]) {
        if (tracking[key] !== undefined) order.tracking[key] = tracking[key] || undefined
      }
    }

    const changed = status && status !== order.status

    if (changed) {
      if (status === 'cancelled') await restoreStock(req.store._id, order.items)
      order.status = status
      if (status === 'delivered') order.deliveredAt = new Date()
      order.statusHistory.push({ status, note: note || '', at: new Date() })
    }

    await order.save()

    if (changed && NOTIFY.includes(status)) {
      sendStatusUpdate(order).catch((e) => console.error('Status email error:', e.message))
    }

    // Marking a paid pickup order ready tells the customer. If the status was
    // also set to "shipped" in the same save, that email already says the same
    // thing, so don't send it twice.
    const nowReady = Boolean(order.tracking?.readyForPickupAt)
    const statusEmailCoversIt = changed && status === 'shipped'
    if (order.deliveryMethod === 'pickup' && order.isPaid && !wasReady && nowReady && !statusEmailCoversIt) {
      sendPickupReady(order).catch((e) => console.error('Pickup email error:', e.message))
    }

    res.json(order)
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}

export const cancelMyOrder = async (req, res) => {
  try {
    // Atomic: only the owner, only while pending and unpaid
    const order = await Order.findOneAndUpdate(
      { ...byId(req), user: req.user._id, status: 'pending', isPaid: false },
      {
        $set: { status: 'cancelled' },
        $push: { statusHistory: { status: 'cancelled', note: 'Cancelled by customer', at: new Date() } },
      },
      { returnDocument: 'after' }
    )

    if (!order) {
      return res.status(400).json({ message: 'This order can no longer be cancelled' })
    }

    await restoreStock(req.store._id, order.items)
    res.json(order)
  } catch (error) {
    res.status(500).json({ message: error.message })
  }
}