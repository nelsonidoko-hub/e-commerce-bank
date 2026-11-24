import User from '../models/User.js'
import Product from '../models/Product.js'
import Order from '../models/Order.js'
import Category from '../models/Category.js'
import Page from '../models/Page.js'
import Discount from '../models/Discount.js'
import HeroSlide from '../models/HeroSlide.js'
import Logo from '../models/Logo.js'
import Settings from '../models/Settings.js'
import PaymentConfig from '../models/PaymentConfig.js'
import Store from '../models/Store.js'
import BillingPayment from '../models/BillingPayment.js'
import SavedDesign from '../models/SavedDesign.js'
import MarketClick from '../models/MarketClick.js'
import MarketReport from '../models/MarketReport.js'
import StudioTemplate from '../models/StudioTemplate.js'

// A database that was used by the single-store version still has its old
// rules, like "one page called faq in the whole database" or "one logo called
// main". On a platform those rules are wrong (every shop has its own faq page
// and logo) and they make the second shop's saves fail.
//
// This removes any such old rule and builds the per-shop ones. Runs on every
// server start; does nothing once the database is up to date.
const SHOP_MODELS = [User, Product, Order, Category, Page, Discount, HeroSlide, Logo, Settings, PaymentConfig]

export async function fixOldIndexes(log = console.log) {
  let dropped = 0
  for (const model of SHOP_MODELS) {
    let indexes = []
    try {
      indexes = await model.collection.indexes()
    } catch {
      continue // collection doesn't exist yet
    }
    for (const index of indexes) {
      if (index.name === '_id_' || !index.unique) continue
      if ('store' in index.key) continue
      await model.collection.dropIndex(index.name)
      log(`Removed old single-store rule ${model.collection.collectionName}.${index.name}`)
      dropped++
    }
  }
  // Build the per-shop rules (and remove indexes the models no longer have)
  for (const model of [...SHOP_MODELS, Store, BillingPayment, SavedDesign, MarketClick, MarketReport, StudioTemplate]) await model.syncIndexes()
  return dropped
}
