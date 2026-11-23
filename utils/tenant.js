import mongoose from 'mongoose'

// The safety net that keeps every shop's data apart.
//
// Added to every model that belongs to a shop (products, orders, pages ...):
//   1. adds a required `store` field, so nothing can be saved without one
//   2. refuses to run any query whose filter doesn't name a store
//
// So if a developer ever forgets `store: req.store._id` in a query, the request
// fails loudly instead of quietly showing one shop another shop's data.
//
// The few jobs that really do work across every shop (the order-expiry timer,
// the migration script) say so on purpose: `.setOptions({ allStores: true })`.

const QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'countDocuments',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'distinct',
]

export class TenantGuardError extends Error {}

// A real store id, not undefined, null or a query trick like { $ne: x }
function namesAStore(value) {
  if (value == null) return false
  if (value instanceof mongoose.Types.ObjectId || value?._bsontype === 'ObjectId') return true
  if (typeof value === 'string') return mongoose.isValidObjectId(value)
  // { $in: [id, ...] } with only real ids
  if (typeof value === 'object' && Array.isArray(value.$in) && Object.keys(value).length === 1) {
    return value.$in.length > 0 && value.$in.every((v) => v instanceof mongoose.Types.ObjectId || (typeof v === 'string' && mongoose.isValidObjectId(v)))
  }
  return false
}

// options.storeIndex = false when the model declares its own index on store
// (Settings: one per shop), so the index isn't defined twice.
export function tenantPlugin(schema, options = {}) {
  schema.add({
    store: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: options.storeIndex !== false, immutable: true },
  })

  schema.pre(QUERY_OPS, function () {
    if (this.getOptions().allStores) return
    const filter = this.getFilter() || {}
    if (!namesAStore(filter.store)) {
      throw new TenantGuardError(
        `Tenant guard: ${this.model.modelName}.${this.op}() ran without a store in its filter`
      )
    }
    // A query must not be able to move a document to another shop
    const update = this.getUpdate?.()
    if (update && (update.store !== undefined || update.$set?.store !== undefined)) {
      throw new TenantGuardError(`Tenant guard: ${this.model.modelName}.${this.op}() tried to change store`)
    }
  })

  schema.pre('aggregate', function () {
    if (this.options?.allStores) return
    const first = this.pipeline()[0]
    if (!first?.$match || !namesAStore(first.$match.store)) {
      throw new TenantGuardError(
        `Tenant guard: ${this.model().modelName}.aggregate() must start with { $match: { store } }`
      )
    }
  })
  // insertMany() still validates, and `store` is required, so it can't add
  // documents without a shop either. bulkWrite() skips all of this: don't use
  // it on shop data.
}

// Shorthand for the filter every shop query starts with
export const inStore = (req, extra = {}) => ({ ...extra, store: req.store._id })

// Request bodies must never choose the shop or the id. Strips those fields,
// and anything starting with $ (query tricks), from the top level.
export function cleanBody(body) {
  const out = {}
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out
  for (const [key, value] of Object.entries(body)) {
    if (key === 'store' || key === '_id' || key === '__v' || key === 'createdAt' || key === 'updatedAt') continue
    if (key.startsWith('$')) continue
    out[key] = value
  }
  return out
}

// Filter for one document of this shop by id. An invalid id becomes one that
// matches nothing, so the caller simply sees "not found" instead of a crash.
export function byId(req, id = req.params.id) {
  const safe = mongoose.isValidObjectId(id) ? id : new mongoose.Types.ObjectId()
  return { _id: safe, store: req.store._id }
}

// "Create it if it isn't there" (an upsert) can still fail when two requests
// do it at the same moment for a brand-new shop: both see nothing, both try
// to create, and the database refuses the second as a duplicate. The first
// one succeeded, so trying again simply finds it.
export async function upsertSafely(run) {
  try {
    return await run()
  } catch (error) {
    if (error?.code !== 11000) throw error
    return run()
  }
}
