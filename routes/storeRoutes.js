import express from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { getStoreStatus } from '../controllers/storeController.js'

const router = express.Router()

// Login is optional here: visitors get the public part, owners get more
async function optionalLogin(req, res, next) {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET, { algorithms: ['HS256'] })
      const user = await User.findById(decoded.id).select('_id store passwordChangedAt')
      const stale = user?.passwordChangedAt && decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
      if (user && !stale) req.user = user
    } catch {
      // treat as a visitor
    }
  }
  next()
}

router.get('/status', optionalLogin, getStoreStatus)

export default router
