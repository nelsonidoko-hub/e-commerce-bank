// Moves a database from the single-store version into the platform version:
// everything that exists becomes shop #1.
//
//   node scripts/migrateToStores.js --name "Abuja Store" --slug abujastore [--prefix ZR] [--dry-run]
//
// What it does:
//   1. creates the shop; the first old admin becomes its owner (a merchant
//      account), any other old admins become staff
//   2. gives every product, order, category, page, discount, slide, logo,
//      setting and payment key that has no shop this shop
//   3. moves every customer account into this shop
//   4. carries the order counter over, so order numbers continue (--prefix keeps
//      the old letters, e.g. ZR-10024)
//   5. swaps the old platform-wide unique rules (one category name, one code
//      ...) for per-shop ones
//   6. publishes it as a paid-up shop for a year, since it is your own
//      existing store (change currentPeriodEnd later if needed)
//
// BACK UP THE DATABASE FIRST (MongoDB Atlas: Backup → Take snapshot).
// Safe to run twice: the second run finds nothing left to move.
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import Store from '../models/Store.js'
import User from '../models/User.js'
import Counter from '../models/Counter.js'
import Product from '../models/Product.js'
import Order from '../models/Order.js'
import Category from '../models/Category.js'
import Page from '../models/Page.js'
import Discount from '../models/Discount.js'
import HeroSlide from '../models/HeroSlide.js'
import Logo from '../models/Logo.js'
import Settings from '../models/Settings.js'
import PaymentConfig from '../models/PaymentConfig.js'

dotenv.config()

const SHOP_MODELS = [Product, Order, Category, Page, Discount, HeroSlide, Logo, Settings, PaymentConfig]

function args() {
  const out = {}
  const list = process.argv.slice(2)
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue
    const key = list[i].slice(2)
    const next = list[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else out[key] = next, i++
  }
  return out
}

export async function migrate({ name, slug, prefix = '', dryRun = false, log = console.log }) {
  if (!name || !slug) throw new Error('--name and --slug are required')
  const users = User.collection

  // 1. the shop and its owner
  let store = await Store.findOne({ slug })
  const oldAdmins = await users.find({ role: 'admin' }).sort({ createdAt: 1 }).toArray()

  if (!store) {
    if (oldAdmins.length === 0) throw new Error('No admin account found to own the shop')
    const owner = oldAdmins[0]
    log(`Owner will be ${owner.email}; ${oldAdmins.length - 1} other admin(s) become staff`)
    if (!dryRun) {
      const yearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
      store = await Store.create({
        name,
        slug,
        owner: owner._id,
        staff: oldAdmins.slice(1).map((a) => a._id),
        notifyEmail: process.env.ADMIN_NOTIFY_EMAIL || owner.email,
        plan: 'pro',
        orderPrefix: String(prefix || process.env.ORDER_PREFIX || '').toUpperCase(),
        publishedAt: new Date(),
        currentPeriodEnd: yearFromNow,
      })
    }
  } else {
    log(`Shop "${slug}" already exists; moving anything left over into it`)
  }
  const storeId = store?._id || new mongoose.Types.ObjectId()

  // 2-3. Old indexes first: the old "one email per platform" rule would stop
  // the same email existing in two shops later.
  for (const model of [User, ...SHOP_MODELS]) {
    const indexes = await model.collection.indexes().catch(() => [])
    const stale = indexes.filter((i) => i.unique && i.name !== '_id_' && !('store' in i.key))
    for (const index of stale) {
      log(`${model.modelName}: removing old unique rule ${index.name}`)
      if (!dryRun) await model.collection.dropIndex(index.name)
    }
  }

  // Plain collection updates on purpose: they skip the safety net, which is
  // exactly what a one-off move of data without a shop needs.
  for (const model of SHOP_MODELS) {
    const count = await model.collection.countDocuments({ store: { $exists: false } })
    log(`${model.modelName}: ${count} to move`)
    if (!dryRun && count) await model.collection.updateMany({ store: { $exists: false } }, { $set: { store: storeId } })
  }
  if (!dryRun) await Settings.collection.updateMany({ store: storeId }, { $unset: { key: '' } })

  const customers = await users.countDocuments({ role: 'customer', store: { $in: [null] } })
  log(`Customers: ${customers} to move into the shop`)
  if (!dryRun) {
    await users.updateMany({ role: 'customer', store: { $in: [null] } }, { $set: { store: storeId } })
    await users.updateMany({ role: 'admin' }, { $set: { role: 'merchant', store: null } })
  }

  // 4. continue order numbers
  const oldCounter = await Counter.findById('order')
  if (oldCounter) {
    log(`Order counter: continuing from ${10000 + oldCounter.seq}`)
    if (!dryRun) {
      await Counter.updateOne({ _id: `${storeId}:order` }, { $max: { seq: oldCounter.seq } }, { upsert: true })
      await Counter.deleteOne({ _id: 'order' })
    }
  }

  // 5. the new per-shop rules
  if (!dryRun) {
    for (const model of [Store, User, ...SHOP_MODELS]) await model.syncIndexes()
  }
  log(dryRun ? 'Dry run: nothing was changed.' : `Done. Shop id: ${storeId}`)
  return store
}

if (process.argv[1]?.endsWith('migrateToStores.js')) {
  const a = args()
  try {
    await mongoose.connect(process.env.MONGO_URI)
    await migrate({ name: a.name, slug: a.slug, prefix: a.prefix, dryRun: Boolean(a['dry-run']) })
  } catch (error) {
    console.error('Migration failed:', error.message)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}
