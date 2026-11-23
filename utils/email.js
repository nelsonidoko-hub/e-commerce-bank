import { getStoreSettings } from '../controllers/settingsController.js'
import Store from '../models/Store.js'
import { storeUrl } from './storeUrl.js'

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const naira = (n) => `₦${Number(n).toLocaleString('en-NG')}`
const orderRef = (o) => o.orderNumber || `#${String(o._id).slice(-8).toUpperCase()}`
const isPickup = (o) => o.deliveryMethod === 'pickup'

// Everything an email needs about the shop it is for: its name and pickup
// address (Admin → Settings), its web address for links, and where owner
// alerts go. ref: the shop, or its id (e.g. order.store).
async function loadStore(ref) {
  const id = ref?._id || ref
  let store = ref?.slug ? ref : null
  try {
    if (!store) store = await Store.findById(id).lean()
    if (!store) throw new Error('shop not found')
    const settings = await getStoreSettings(store)
    return {
      name: settings.storeName || store.name,
      pickup: settings.pickup || {},
      notifyEmail: store.notifyEmail || settings.contactEmail || '',
      url: (path) => storeUrl(store, path),
    }
  } catch (error) {
    console.error('Could not load shop for email:', error.message)
    return {
      name: store?.name || 'Your shop',
      pickup: {},
      notifyEmail: store?.notifyEmail || '',
      url: (path) => (store ? storeUrl(store, path) : path),
    }
  }
}

// Emails go out from the platform's address (EMAIL_FROM) but show the shop's
// name, and customers' replies go to the shop, not to the platform.
function fromLine(storeName) {
  const configured = process.env.EMAIL_FROM || ''
  const address = configured.match(/<([^>]+)>/)?.[1] || configured || 'onboarding@resend.dev'
  const name = String(storeName || 'Your shop').replace(/["<>\r\n]/g, '').slice(0, 60)
  return `"${name}" <${address}>`
}

async function sendEmail({ to, subject, html, storeName, replyTo }) {
  if (!to) return
  if (!process.env.RESEND_API_KEY) {
    console.log(`[email skipped - no RESEND_API_KEY] ${subject} -> ${to}`)
    return
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromLine(storeName),
      ...(replyTo ? { reply_to: replyTo } : {}),
      to,
      subject,
      html,
    }),
  })
  if (!res.ok) console.error('Email failed:', res.status, await res.text())
}

function layout(heading, body, storeName) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
    <h2 style="margin:0 0 16px">${esc(heading)}</h2>${body}
    <p style="color:#888;font-size:12px;margin-top:32px">${esc(storeName)}</p></div>`
}

// Items, then the price breakdown. Orders placed before the breakdown was
// saved (subtotal of 0) just show the total, as they always did.
function itemsTable(order) {
  const rows = order.items
    .map(
      (i) => `<tr><td style="padding:6px 0">${esc(i.name)} (${esc(i.size)}) × ${i.quantity}</td>
      <td style="padding:6px 0;text-align:right">${naira(i.price * i.quantity)}</td></tr>`
    )
    .join('')

  const line = (label, value) =>
    `<tr><td style="padding:3px 0;color:#555">${label}</td><td style="padding:3px 0;text-align:right;color:#555">${value}</td></tr>`

  let breakdown = ''
  if (order.subtotal > 0) {
    breakdown += line('Subtotal', naira(order.subtotal))
    if (order.discountAmount > 0) {
      const code = order.discountCode ? ` (${esc(order.discountCode)})` : ''
      breakdown += line(`Discount${code}`, `-${naira(order.discountAmount)}`)
    }
    breakdown += line(isPickup(order) ? 'Pickup' : 'Delivery', order.shippingCost > 0 ? naira(order.shippingCost) : 'Free')
    if (order.taxAmount > 0) breakdown += line('Tax', naira(order.taxAmount))
  }

  return `<table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;border-bottom:1px solid #eee">${rows}${breakdown}
    <tr><td style="padding:8px 0"><b>Total</b></td><td style="text-align:right"><b>${naira(order.totalPrice)}</b></td></tr></table>`
}

// Where the order is going: an address for delivery, the store for pickup
function deliveryBlock(order) {
  const a = order.shippingAddress || {}
  if (isPickup(order)) {
    return `<p><b>Pickup from:</b><br>${esc(a.location || 'our store')}<br>${esc(a.phone)}</p>`
  }
  const place = [a.address, a.city].filter(Boolean).map((part) => esc(part)).join(', ')
  return `<p><b>Delivering to:</b><br>${place}<br>${esc(a.phone)}</p>`
}

// The customer's note and the pre-order flag, when there are any
function extrasBlock(order, forAdmin = false) {
  let html = ''
  if (order.isPreOrder) {
    html += forAdmin
      ? `<p style="background:#fff7ed;padding:8px 12px;border-radius:6px"><b>Pre-order:</b> placed while the shop was closed.</p>`
      : `<p style="background:#fff7ed;padding:8px 12px;border-radius:6px"><b>Pre-order:</b> you ordered while we were closed. We will start on it as soon as we open.</p>`
  }
  if (order.customerNote) {
    html += `<p><b>${forAdmin ? 'Customer note' : 'Your note'}:</b><br>${esc(order.customerNote).replace(/\n/g, '<br>')}</p>`
  }
  return html
}

const viewButton = (order, store) =>
  `<p><a href="${esc(store.url(`/orders/${order._id}`))}" style="background:#111;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block">View your order</a></p>`

export async function sendPasswordReset(user, resetUrl, shop) {
  const store = await loadStore(shop)
  await sendEmail({
    to: user.email,
    storeName: store.name,
    subject: 'Reset your password',
    html: layout(
      'Reset your password',
      `<p>Hi ${esc(user.name)}, click below to set a new password. This link expires in 30 minutes.</p>
       <p><a href="${esc(resetUrl)}" style="background:#111;color:#fff;padding:10px 18px;text-decoration:none;border-radius:6px;display:inline-block">Reset password</a></p>
       <p style="color:#888;font-size:13px">If you did not request this, you can ignore this email.</p>`,
      store.name
    ),
  })
}

export async function sendOrderConfirmation(order) {
  const store = await loadStore(order.store)
  const followUp = isPickup(order)
    ? 'We will email you again when it is ready for pickup.'
    : 'We will email you again as it moves along.'

  await sendEmail({
    to: order.user.email,
    replyTo: store.notifyEmail,
    storeName: store.name,
    subject: `Order ${orderRef(order)} confirmed`,
    html: layout(
      `Thanks for your order, ${order.user.name}!`,
      `<p>We have received your payment for order <b>${esc(orderRef(order))}</b>. ${followUp}</p>
       ${itemsTable(order)}
       ${extrasBlock(order)}
       ${deliveryBlock(order)}
       ${viewButton(order, store)}`,
      store.name
    ),
  })
}

// Sent when a pickup order is ready to collect
export async function sendPickupReady(order) {
  const store = await loadStore(order.store)
  const a = order.shippingAddress || {}
  const location = a.location || store.pickup.name || 'our store'
  const address = store.pickup.address
  const note = order.tracking?.pickupNote

  await sendEmail({
    to: order.user.email,
    replyTo: store.notifyEmail,
    storeName: store.name,
    subject: `Your order is ready for pickup - ${orderRef(order)}`,
    html: layout(
      'Your order is ready for pickup',
      `<p>Hi ${esc(order.user.name)}, your order <b>${esc(orderRef(order))}</b> is ready for you to collect.</p>
       <p><b>Pick up from:</b><br>${esc(location)}${address ? `<br>${esc(address)}` : ''}</p>
       ${note ? `<p><b>Note from the store:</b><br>${esc(note)}</p>` : ''}
       <p style="color:#555;font-size:13px">Please have your order number ready when you arrive.</p>
       ${itemsTable(order)}${viewButton(order, store)}`,
      store.name
    ),
  })
}

export async function sendStatusUpdate(order) {
  // For pickup orders, "shipped" means "ready to collect"
  if (order.status === 'shipped' && isPickup(order)) {
    return sendPickupReady(order)
  }

  const pickup = isPickup(order)
  const messages = {
    processing: { subject: 'We are preparing your order', text: 'we have started getting your order ready.' },
    shipped: { subject: 'Your order is on its way', text: 'your order has been handed over for delivery.' },
    delivered: pickup
      ? { subject: 'Thanks for collecting your order', text: 'your order is marked as collected. We hope you love it!' }
      : { subject: 'Your order has been delivered', text: 'your order is marked as delivered. We hope you love it!' },
    cancelled: { subject: 'Your order was cancelled', text: 'your order has been cancelled. If you already paid, please contact us about your refund.' },
  }
  const m = messages[order.status]
  if (!m) return

  const store = await loadStore(order.store)

  const t = order.tracking || {}
  let trackingHtml = ''
  if (order.status === 'shipped') {
    const lines = []
    if (t.courier) lines.push(`Courier: ${esc(t.courier)}`)
    if (t.trackingNumber) lines.push(`Tracking number: ${esc(t.trackingNumber)}`)
    if (t.riderPhone) lines.push(`Rider phone: ${esc(t.riderPhone)}`)
    if (t.estimatedDelivery) lines.push(`Expected by: ${new Date(t.estimatedDelivery).toDateString()}`)
    if (t.trackingUrl && /^https?:\/\//i.test(t.trackingUrl)) {
      lines.push(`<a href="${esc(t.trackingUrl)}">Track your package</a>`)
    }
    if (lines.length) trackingHtml = `<p>${lines.join('<br>')}</p>`
  }

  await sendEmail({
    to: order.user.email,
    replyTo: store.notifyEmail,
    storeName: store.name,
    subject: `${m.subject} - ${orderRef(order)}`,
    html: layout(
      m.subject,
      `<p>Hi ${esc(order.user.name)}, ${m.text}</p>${trackingHtml}${itemsTable(order)}${viewButton(order, store)}`,
      store.name
    ),
  })
}

export async function notifyAdminNewOrder(order) {
  const store = await loadStore(order.store)
  const a = order.shippingAddress || {}
  const where = isPickup(order)
    ? `<p><b>Store pickup</b> from ${esc(a.location || 'the store')}</p>`
    : `<p>${[a.address, a.city].filter(Boolean).map((part) => esc(part)).join(', ')}</p>`

  await sendEmail({
    to: store.notifyEmail,
    storeName: store.name,
    subject: `New ${order.isPreOrder ? 'pre-order' : 'order'} ${orderRef(order)} - ${naira(order.totalPrice)}${isPickup(order) ? ' (pickup)' : ''}`,
    html: layout(
      'New paid order',
      `<p><b>${esc(order.user.name)}</b> (${esc(order.user.email)}, ${esc(a.phone)}) just paid.</p>
       ${itemsTable(order)}${where}${extrasBlock(order, true)}`,
      store.name
    ),
  })
}

export async function notifyAdminRefundNeeded(order) {
  const store = await loadStore(order.store)
  await sendEmail({
    to: store.notifyEmail,
    storeName: store.name,
    subject: `REFUND NEEDED - order ${orderRef(order)}`,
    html: layout(
      'Refund needed',
      `<p>${esc(order.user.name)} (${esc(order.user.email)}) paid ${naira(order.totalPrice)} for order
       <b>${esc(orderRef(order))}</b>, but the order was already cancelled and the stock could not be
       reserved again. Please refund the payment (reference: ${esc(order.paymentReference)}) from your Paystack dashboard.</p>
       ${itemsTable(order)}`,
      store.name
    ),
  })
}

// Sent to the owner whenever the Paystack settings change, so a change they
// didn't make is noticed straight away.
export async function notifyAdminPaymentKeysChanged({ store: shop, by, changes }) {
  const store = await loadStore(shop)
  await sendEmail({
    to: store.notifyEmail,
    storeName: store.name,
    subject: 'Your Paystack payment settings were changed',
    html: layout(
      'Payment settings changed',
      `<p><b>${esc(by.name)}</b> (${esc(by.email)}) changed the Paystack settings: ${esc(changes.join(', '))}.</p>
       <p>If this was not you, change your admin password straight away and check your Paystack account.</p>`,
      store.name
    ),
  })
}