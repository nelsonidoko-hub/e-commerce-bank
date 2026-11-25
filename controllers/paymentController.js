import axios from 'axios'
import mongoose from 'mongoose'
import Order from '../models/Order.js'
import Store from '../models/Store.js'
import { markOrderPaid } from '../utils/payments.js'
import { HOLD_MINUTES } from '../utils/expireOrders.js'
import {
  resolvePaystack,
  getPaystackSecret,
  signatureMatches,
  paystackApi,
  PaymentSetupError,
} from '../utils/paystackConfig.js'
import { storeUrl } from '../utils/storeUrl.js'

// Every payment uses the shop's OWN Paystack key (Admin → Payments), so the
// customer's money goes straight to that shop's Paystack account.

function paymentError(res, error, where) {
  if (error instanceof PaymentSetupError) {
    return res.status(503).json({ message: error.publicMessage })
  }
  const paystackMessage = error.response?.data?.message
  console.error(`${where} error:`, paystackMessage || error.message)
  res.status(502).json({ message: paystackMessage || 'Payment could not be started. Please try again.' })
}

export const initializePayment = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.body.orderId)) {
      return res.status(404).json({ message: 'Order not found' })
    }
    const order = await Order.findOne({ store: req.store._id, _id: req.body.orderId })

    if (!order) return res.status(404).json({ message: 'Order not found' })
    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' })
    }
    if (order.isPaid) return res.status(400).json({ message: 'This order is already paid' })
    if (order.paymentMethod && order.paymentMethod !== 'paystack') {
      return res.status(400).json({ message: 'This order is paid by bank transfer or on delivery, not online' })
    }
    if (order.status === 'cancelled') {
      return res.status(400).json({ message: 'This order expired or was cancelled. Please place it again.' })
    }

    // Checked before the hold is extended, so a shop with no key doesn't keep stock held
    const secret = await getPaystackSecret(req.store._id)

    // Fresh hold window while the customer pays; fails if the order was cancelled a moment ago
    const extended = await Order.updateOne(
      { store: req.store._id, _id: order._id, status: 'pending', isPaid: false },
      { $set: { expiresAt: new Date(Date.now() + HOLD_MINUTES * 60 * 1000) } }
    )
    if (extended.matchedCount === 0) {
      return res.status(400).json({ message: 'This order expired. Please place it again.' })
    }

    const response = await axios.post(
      `${paystackApi()}/transaction/initialize`,
      {
        email: req.user.email,
        amount: Math.round(order.totalPrice * 100),
        callback_url: storeUrl(req.store, '/payment-success'),
        metadata: {
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          storeId: req.store._id.toString(),
        },
      },
      { headers: { Authorization: `Bearer ${secret}` }, timeout: 15000 }
    )

    res.json(response.data)
  } catch (error) {
    paymentError(res, error, 'initializePayment')
  }
}

export const verifyPayment = async (req, res) => {
  try {
    const secret = await getPaystackSecret(req.store._id)
    const { data } = await axios.get(
      `${paystackApi()}/transaction/verify/${encodeURIComponent(req.params.reference)}`,
      { headers: { Authorization: `Bearer ${secret}` }, timeout: 15000 }
    )
    const tx = data.data

    if (tx.status !== 'success') {
      return res.status(400).json({ success: false, message: 'Payment was not successful' })
    }

    // Asked with this shop's key, so Paystack only returns this shop's payments;
    // markOrderPaid also refuses orders from any other shop.
    const { order, mismatch } = await markOrderPaid(req.store._id, tx.metadata?.orderId, tx.reference, tx.amount)

    if (!order || mismatch) {
      return res.status(400).json({ success: false, message: 'Payment could not be matched to an order' })
    }

    if (String(order.user._id || order.user) !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' })
    }

    if (order.status === 'cancelled') {
      return res.status(409).json({
        success: false,
        message:
          'Your payment was received, but this order had expired and the items are no longer available. We will refund you and email you shortly.',
      })
    }

    res.json({ success: true, order })
  } catch (error) {
    if (error instanceof PaymentSetupError) return res.status(503).json({ message: error.publicMessage })
    res.status(500).json({ success: false, message: error.response?.data?.message || 'Could not check the payment' })
  }
}

// Paystack calls this directly, so the order is marked paid even if the
// customer closes the tab. Each shop has its own address,
// /api/payments/webhook/<storeId>, set in that shop's Paystack dashboard.
// The signature is checked with that shop's key in its current mode, so
// neither another shop nor a test-mode event can mark an order paid.
export const paystackWebhook = async (req, res) => {
  try {
    const { storeId } = req.params
    if (!mongoose.isValidObjectId(storeId)) return res.sendStatus(404)

    const store = await Store.findById(storeId).select('_id').lean()
    if (!store) return res.sendStatus(404)

    const { secret } = await resolvePaystack(store._id)
    if (!secret) return res.sendStatus(401)

    if (!signatureMatches(req.rawBody, req.headers['x-paystack-signature'], secret)) {
      return res.sendStatus(401)
    }

    const event = req.body
    if (event?.event === 'charge.success') {
      const tx = event.data
      await markOrderPaid(store._id, tx.metadata?.orderId, tx.reference, tx.amount)
    }

    res.sendStatus(200)
  } catch (error) {
    console.error('Webhook error:', error.message)
    res.sendStatus(500)
  }
}
