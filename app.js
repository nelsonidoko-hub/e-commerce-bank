import express from 'express'
import helmet from 'helmet'
import corsMiddleware from './middleware/corsConfig.js'
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
import storeRoutes from './routes/storeRoutes.js'
import platformRoutes from './routes/platformRoutes.js'
import designRoutes from './routes/designRoutes.js'
import billingRoutes from './routes/billingRoutes.js'
import { marketRouter, marketSettingsRouter } from './routes/marketRoutes.js'
import founderRoutes from './routes/founderRoutes.js'
import domainRoutes from './routes/domainRoutes.js'
import { billingWebhook } from './controllers/billingController.js'
import { paystackWebhook } from './controllers/paymentController.js'
import { resolveStore, storeOpen } from './middleware/storeMiddleware.js'

// The Express app on its own, without connecting to a database or listening.
// server.js starts it for real; the isolation tests start it on a test database.
export function createApp() {
  const app = express()

  // Render and similar hosts sit behind a proxy. Without this, every visitor
  // looks like the same address and the rate limits would lock everyone out together.
  app.set('trust proxy', 1)

  app.use(helmet())
  app.use(corsMiddleware)
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }))

  app.get('/', (req, res) => {
    res.send('Store platform API is running')
  })

  // Paystack's servers call this. The address names the shop
  // (/api/payments/webhook/<storeId>), so it comes before the shop lookup.
  app.post('/api/payments/webhook/:storeId', paystackWebhook)
  // Paystack → the platform's own account (merchants paying for their plan)
  app.post('/api/billing/webhook', billingWebhook)

  // The platform's own site: templates, sign-up, a merchant's shops.
  // Not for any one shop, so before the shop lookup.
  app.use('/api/platform', platformRoutes)
  // The founder dashboard (platform owner only)
  app.use('/api/founder', founderRoutes)
  app.use('/api/market', marketRouter)

  // Everything else is for one shop: work out which (req.store), then hide it
  // from visitors if it isn't live. See middleware/storeMiddleware.js.
  app.use('/api', resolveStore, storeOpen)

  app.use('/api/store', storeRoutes)
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
  app.use('/api/designs', designRoutes)
  app.use('/api/billing', billingRoutes)
  app.use('/api/domain', domainRoutes)
  app.use('/api/market-settings', marketSettingsRouter)

  // Catch-all so errors come back as JSON and never expose a stack trace
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ message: 'Invalid request body' })
    }
    console.error('Unhandled error:', err)
    res.status(500).json({ message: 'Something went wrong' })
  })
  return app
}
