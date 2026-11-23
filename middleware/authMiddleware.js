import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { canManageStore } from '../utils/storeAccess.js'

// Two kinds of account:
//   customer  belongs to one shop (user.store). Their login only works there,
//             like Shopify: the same email can shop at two stores separately.
//   merchant  belongs to the platform (user.store is null) and runs shops.
//
// Every route below runs after resolveStore, so req.store is the shop the
// request is for.

export const protect = async (req, res, next) => {
  const header = req.headers.authorization

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token' })
  }

  try {
    const token = header.split(' ')[1]
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })

    const user = await User.findById(decoded.id).select('-password -resetToken -resetTokenExpires')

    // The account was deleted after the token was issued
    if (!user) {
      return res.status(401).json({ message: 'Not authorized, account not found' })
    }

    // The password changed after this token was issued, so sign this session out
    if (
      user.passwordChangedAt &&
      decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      return res.status(401).json({ message: 'Not authorized, please log in again' })
    }

    // A customer of one shop can never act in another shop
    if (user.store && (!req.store || String(user.store) !== String(req.store._id))) {
      return res.status(401).json({ message: 'Not authorized, please log in again' })
    }

    req.user = user
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token failed' })
  }

  // Called outside the try block on purpose: an error in a later route should
  // be a server error, not be reported as a failed login.
  next()
}

// "Admin" means: runs THIS shop (its owner, or staff on Pro).
// Owning another shop gives no access here.
export const admin = (req, res, next) => {
  if (req.user && canManageStore(req.user, req.store)) {
    next()
  } else {
    res.status(403).json({ message: 'Not authorized as admin' })
  }
}

// Who is looking, if they sent a valid login; never refuses the request.
// Used where visitors and owners both call the same address (e.g. preview).
export const optionalLogin = async (req, res, next) => {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET, { algorithms: ['HS256'] })
      const user = await User.findById(decoded.id).select('_id store role passwordChangedAt')
      const stale = user?.passwordChangedAt && decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
      const wrongShop = user?.store && String(user.store) !== String(req.store?._id)
      if (user && !stale && !wrongShop) req.user = user
    } catch {
      // treat as a visitor
    }
  }
  next()
}
