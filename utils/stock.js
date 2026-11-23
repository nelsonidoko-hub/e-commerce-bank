import Product from '../models/Product.js'

// Stock always belongs to one shop: storeId is required.
export async function restoreStock(storeId, items) {
  if (!storeId) throw new Error('restoreStock needs a store')
  for (const item of items) {
    await Product.updateOne(
      { store: storeId, _id: item.product, 'sizes.size': item.size },
      { $inc: { 'sizes.$.stock': item.quantity } }
    )
  }
}

// Takes stock for every item, or none of it (rolls back if any item is short)
export async function reserveStock(storeId, items) {
  if (!storeId) throw new Error('reserveStock needs a store')
  const taken = []
  for (const item of items) {
    const updated = await Product.findOneAndUpdate(
      {
        store: storeId,
        _id: item.product,
        sizes: { $elemMatch: { size: item.size, stock: { $gte: item.quantity } } },
      },
      { $inc: { 'sizes.$.stock': -item.quantity } }
    )
    if (!updated) {
      await restoreStock(storeId, taken)
      return false
    }
    taken.push(item)
  }
  return true
}