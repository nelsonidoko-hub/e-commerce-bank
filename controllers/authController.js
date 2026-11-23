import User from '../models/User.js'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { sendPasswordReset } from '../utils/email.js'
import { canManageStore } from '../utils/storeAccess.js'
import { storeUrl } from '../utils/storeUrl.js'
import {
  cleanEmail,
  cleanName,
  validPassword,
  isString,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '../utils/validate.js'

// People who run a shop get a shorter session than customers
const generateToken = (userId, isAdmin) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: isAdmin ? '7d' : '30d',
  })

// role is the person's role IN THIS SHOP: 'admin' if they run it, otherwise
// 'customer'. The storefront's admin checks rely on this.
const userResponse = (user, store) => {
  const isAdmin = canManageStore(user, store)
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: isAdmin ? 'admin' : 'customer',
    token: generateToken(user._id, isAdmin),
  }
}

// The accounts that may sign in on this shop with this email: the shop's own
// customer account, and a platform (merchant) account if it runs this shop.
async function accountsFor(store, email) {
  const [customer, merchant] = await Promise.all([
    User.findOne({ store: store._id, email }),
    User.findOne({ store: null, email }),
  ])
  return [customer, merchant && canManageStore(merchant, store) ? merchant : null].filter(Boolean)
}

const PASSWORD_MESSAGE = `Password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters`

// The real error goes to the server log, not to the visitor
function serverError(res, error, where) {
  console.error(`${where} error:`, error)
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
}

// Compared against when no account exists, so "no such email" takes as long
// as "wrong password" and can't be told apart by timing.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)

export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body

    const cleanedName = cleanName(name)
    const cleanedEmail = cleanEmail(email)
    if (!cleanedName || !cleanedEmail) {
      return res.status(400).json({ message: 'Enter your name and a valid email address' })
    }
    if (!validPassword(password)) {
      return res.status(400).json({ message: PASSWORD_MESSAGE })
    }

    // Customer accounts belong to this shop only
    if (await User.findOne({ store: req.store._id, email: cleanedEmail })) {
      return res.status(400).json({ message: 'User already exists' })
    }

    // Role and shop are never read from the request, so nobody can sign up as
    // an admin or into another shop
    const user = await User.create({
      store: req.store._id,
      name: cleanedName,
      email: cleanedEmail,
      password,
      role: 'customer',
    })

    res.status(201).json(userResponse(user, req.store))
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'User already exists' })
    }
    serverError(res, error, 'registerUser')
  }
}

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body
    const cleanedEmail = cleanEmail(email)

    if (!cleanedEmail || !isString(password)) {
      return res.status(400).json({ message: 'Enter your email and password' })
    }

    const accounts = await accountsFor(req.store, cleanedEmail)

    if (accounts.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH)
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    // Usually one account. If someone runs this shop AND has a customer
    // account here with the same email, the password decides which one.
    for (const user of accounts) {
      if (await user.matchPassword(password)) return res.json(userResponse(user, req.store))
    }
    res.status(401).json({ message: 'Invalid email or password' })
  } catch (error) {
    serverError(res, error, 'loginUser')
  }
}

export const getAllCustomers = async (req, res) => {
  try {
    const users = await User.find({ store: req.store._id, role: 'customer' }).select(
      '-password -resetToken -resetTokenExpires'
    )
    res.json(users)
  } catch (error) {
    serverError(res, error, 'getAllCustomers')
  }
}

export const forgotPassword = async (req, res) => {
  try {
    const email = cleanEmail(req.body.email)
    if (!email) {
      return res.status(400).json({ message: 'Enter a valid email address' })
    }

    // Always respond the same way, so it can't be used to check which emails are registered
    const accounts = await accountsFor(req.store, email)
    for (const user of accounts) {
      const rawToken = crypto.randomBytes(32).toString('hex')
      user.resetToken = crypto.createHash('sha256').update(rawToken).digest('hex')
      user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000)
      await user.save()

      const resetUrl = storeUrl(req.store, `/reset-password/${rawToken}`)
      sendPasswordReset(user, resetUrl, req.store).catch((e) => console.error('Reset email error:', e.message))
    }

    res.json({ message: 'If that email is registered, a reset link has been sent.' })
  } catch (error) {
    serverError(res, error, 'forgotPassword')
  }
}

export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body

    if (!isString(token) || !token) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired' })
    }
    if (!validPassword(password)) {
      return res.status(400).json({ message: PASSWORD_MESSAGE })
    }

    const hashed = crypto.createHash('sha256').update(token).digest('hex')

    const user = await User.findOne({
      resetToken: hashed,
      resetTokenExpires: { $gt: new Date() },
    })

    // The link only works on the shop it was sent from
    const belongsHere = user && (user.store ? String(user.store) === String(req.store._id) : canManageStore(user, req.store))
    if (!belongsHere) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired' })
    }

    // Saving a new password also signs out every older session (see User.js)
    user.password = password
    user.resetToken = undefined
    user.resetTokenExpires = undefined
    await user.save()

    res.json(userResponse(user, req.store))
  } catch (error) {
    serverError(res, error, 'resetPassword')
  }
}