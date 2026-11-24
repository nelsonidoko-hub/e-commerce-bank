import express from 'express'
import { platformProtect } from '../controllers/platformController.js'
import { superadminOnly, overview, listShops, getShop, shopAction, listTeam, addDesigner, removeDesigner } from '../controllers/founderController.js'
import { paymentSettingsLimiter } from '../middleware/rateLimiters.js'

// The founder dashboard. Platform owner (superadmin) only.
// Mounted in app.js before the shop lookup: it isn't about one shop.
const router = express.Router()
router.use(platformProtect, superadminOnly)

router.get('/overview', overview)
router.get('/shops', listShops)
router.get('/shops/:id', getShop)
router.post('/shops/:id/action', paymentSettingsLimiter, shopAction)
router.get('/team', listTeam)
router.post('/team', addDesigner)
router.delete('/team/:id', removeDesigner)

export default router
