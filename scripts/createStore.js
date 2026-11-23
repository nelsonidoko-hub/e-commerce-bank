// Creates a shop and its owner's merchant account. Until merchant sign-up is
// built (Phase 2), this is how shops are made.
//
//   node scripts/createStore.js --name "Amaka Styles" --slug amaka \
//     --email amaka@example.com --password "a-long-password" [--plan pro] [--publish]
//
// --publish makes it live straight away with the free trial (TRIAL_DAYS).
// Without it the shop is a draft: only the owner can see it.
// If the email already has a merchant account, the shop is added to it and
// --password is ignored.
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import Store from '../models/Store.js'
import User from '../models/User.js'
import { getStoreSettings } from '../controllers/settingsController.js'
import { trialDays } from '../utils/plans.js'
import { storeUrl } from '../utils/storeUrl.js'

dotenv.config()

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

export async function createStore({ name, slug, email, password, plan = 'basic', publish = false }) {
  if (!name || !slug || !email) throw new Error('--name, --slug and --email are required')
  email = String(email).trim().toLowerCase()
  slug = String(slug).trim().toLowerCase()

  if (await Store.exists({ slug })) throw new Error(`The address "${slug}" is already taken`)

  let owner = await User.findOne({ store: null, email })
  if (!owner) {
    if (!password || String(password).length < 8) throw new Error('--password (8+ characters) is required for a new account')
    owner = await User.create({ store: null, role: 'merchant', name: name, email, password: String(password) })
  } else if (owner.role === 'customer') {
    throw new Error('That platform account cannot own shops')
  }

  const now = new Date()
  const store = await Store.create({
    name,
    slug,
    owner: owner._id,
    notifyEmail: email,
    plan,
    publishedAt: publish ? now : null,
    trialEndsAt: publish ? new Date(now.getTime() + trialDays() * 24 * 60 * 60 * 1000) : null,
  })

  await getStoreSettings(store)
  return { store, owner }
}

// Run from the command line
if (process.argv[1]?.endsWith('createStore.js')) {
  const a = args()
  try {
    await mongoose.connect(process.env.MONGO_URI)
    const { store, owner } = await createStore({
      name: a.name,
      slug: a.slug,
      email: a.email,
      password: a.password,
      plan: a.plan === 'pro' ? 'pro' : 'basic',
      publish: Boolean(a.publish),
    })
    console.log(`Created "${store.name}" for ${owner.email}`)
    console.log(`  Address: ${storeUrl(store)}`)
    console.log(`  Admin:   ${storeUrl(store, '/admin')}`)
    console.log(`  Status:  ${store.publishedAt ? `live, free trial until ${store.trialEndsAt.toDateString()}` : 'draft (only the owner can see it)'}`)
    console.log(`  Webhook: /api/payments/webhook/${store._id}`)
  } catch (error) {
    console.error('Could not create the shop:', error.message)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}
