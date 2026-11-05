import express from 'express'
import helmet from 'helmet'
import corsMiddleware from './middleware/corsConfig.js'
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import productRoutes from './routes/productRoutes.js'
import userRoutes from './routes/userRoutes.js'
import orderRoutes from './routes/orderRoutes.js'
import paymentRoutes from './routes/paymentRoutes.js'
import uploadRoutes from './routes/uploadRoutes.js'
import categoryRoutes from './routes/categoryRoutes.js'
import logoRoutes from './routes/logoRoutes.js'
import heroRoutes from './routes/heroRoutes.js'
import settingsRoutes from './routes/settingsRoutes.js'
import discountRoutes from './routes/discountRoutes.js'
import pageRoutes from './routes/pageRoutes.js'
import paymentSettingsRoutes from './routes/paymentSettingsRoutes.js'
import { startOrderExpiryJob } from './utils/expireOrders.js'

dotenv.config()

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn(
    'SECURITY: JWT_SECRET is missing or shorter than 32 characters. Use a long random value. ' +
      'Changing it signs everyone out.'
  )
}

const app = express()

// Render and similar hosts sit behind a proxy. Without this, every visitor
// looks like the same address and the rate limits would lock everyone out together.
app.set('trust proxy', 1)

app.use(helmet())
app.use(corsMiddleware)
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }))

app.use('/api/products', productRoutes)
app.use('/api/users', userRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/logos', logoRoutes)
app.use('/api/hero', heroRoutes)
app.use('/api/settings', settingsRoutes)
app.use('/api/discounts', discountRoutes)
app.use('/api/pages', pageRoutes)
app.use('/api/payment-settings', paymentSettingsRoutes)

app.get('/', (req, res) => {
  res.send('Abuja Store API is running')
})

// Catch-all so errors come back as JSON and never expose a stack trace
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Invalid request body' })
  }
  console.error('Unhandled error:', err)
  res.status(500).json({ message: 'Something went wrong' })
})

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected')
    startOrderExpiryJob()
  })
  .catch((err) => console.error('MongoDB connection error:', err))

const PORT = process.env.PORT || 5000

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
  console.log('THIS SERVER.JS IS RUNNING - VERSION CHECK')
})