import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { createApp } from './app.js'
import { startOrderExpiryJob } from './utils/expireOrders.js'
import { fixOldIndexes } from './utils/fixIndexes.js'
import { startBillingJob } from './utils/billing.js'

dotenv.config()

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn(
    'SECURITY: JWT_SECRET is missing or shorter than 32 characters. Use a long random value. ' +
      'Changing it signs everyone out.'
  )
}
if (!process.env.PLATFORM_DOMAIN && process.env.NODE_ENV === 'production') {
  console.warn('PLATFORM_DOMAIN is not set: shops can only be reached with X-Store-Slug (development mode).')
}
if (process.env.DEFAULT_STORE_SLUG && process.env.NODE_ENV === 'production') {
  console.warn('DEFAULT_STORE_SLUG is set in production: unknown addresses will show that shop. Remove it.')
}

const app = createApp()

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected')
    // Clear out rules left by the single-store version (see utils/fixIndexes.js)
    await fixOldIndexes().catch((e) => console.error('Index check failed:', e.message))
    startOrderExpiryJob()
    startBillingJob()
  })
  .catch((err) => console.error('MongoDB connection error:', err))

const PORT = process.env.PORT || 5000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})