import express from 'express'
import { marketMeta, marketProducts, marketClick, marketReport, getMarketSettings, saveMarketSettings } from '../controllers/marketController.js'
import { protect, admin } from '../middleware/authMiddleware.js'
import { marketClickLimiter, marketReportLimiter } from '../middleware/rateLimiters.js'

// Public Market Square (mounted before the shop lookup: it spans all shops)
export const marketRouter = express.Router()
marketRouter.get('/meta', marketMeta)
marketRouter.get('/products', marketProducts)
marketRouter.post('/click', marketClickLimiter, marketClick)
marketRouter.post('/report', marketReportLimiter, marketReport)

// One shop's own market settings (mounted after the shop lookup)
export const marketSettingsRouter = express.Router()
marketSettingsRouter.get('/', protect, admin, getMarketSettings)
marketSettingsRouter.put('/', protect, admin, saveMarketSettings)
