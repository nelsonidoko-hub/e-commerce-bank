import jwt from 'jsonwebtoken'
import User from '../models/User.js'

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

    req.user = user
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token failed' })
  }

  // Called outside the try block on purpose: an error in a later route should
  // be a server error, not be reported as a failed login.
  next()
}

export const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next()
  } else {
    res.status(403).json({ message: 'Not authorized as admin' })
  }
}