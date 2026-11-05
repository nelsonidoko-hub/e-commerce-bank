import User from '../models/User.js'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { sendPasswordReset } from '../utils/email.js'
import {
  cleanEmail,
  cleanName,
  validPassword,
  isString,
  safeEqual,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from '../utils/validate.js'

// Admins get a shorter session than customers
const generateToken = (userId, role) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: role === 'admin' ? '7d' : '30d',
  })

const userResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  token: generateToken(user._id, user.role),
})

const PASSWORD_MESSAGE = `Password must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters`

// The real error goes to the server log, not to the visitor
function serverError(res, error, where) {
  console.error(`${where} error:`, error)
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
}

// Compared against when no account exists, so "no such email" takes as long
// as "wrong password" and can't be told apart by timing.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)

export const registerAdmin = async (req, res) => {
  try {
    const { name, email, password, setupKey } = req.body
    const expectedKey = process.env.ADMIN_SETUP_KEY

    // With no key configured this stays closed. Without this check, a missing
    // key on the server would match a missing key in the request.
    if (!expectedKey || !safeEqual(setupKey, expectedKey)) {
      return res.status(403).json({ message: 'Invalid setup key' })
    }

    // Only the first admin can be created this way, unless you deliberately
    // set ALLOW_ADMIN_SETUP=true on the server for a moment.
    const adminExists = await User.exists({ role: 'admin' })
    if (adminExists && process.env.ALLOW_ADMIN_SETUP !== 'true') {
      return res.status(403).json({ message: 'An admin account already exists' })
    }

    const cleanedName = cleanName(name)
    const cleanedEmail = cleanEmail(email)
    if (!cleanedName || !cleanedEmail) {
      return res.status(400).json({ message: 'Enter a name and a valid email address' })
    }
    if (!validPassword(password)) {
      return res.status(400).json({ message: PASSWORD_MESSAGE })
    }

    if (await User.findOne({ email: cleanedEmail })) {
      return res.status(400).json({ message: 'User already exists' })
    }

    const user = await User.create({
      name: cleanedName,
      email: cleanedEmail,
      password,
      role: 'admin',
    })

    res.status(201).json(userResponse(user))
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'User already exists' })
    }
    serverError(res, error, 'registerAdmin')
  }
}

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

    if (await User.findOne({ email: cleanedEmail })) {
      return res.status(400).json({ message: 'User already exists' })
    }

    // Role is never read from the request, so nobody can sign up as an admin
    const user = await User.create({ name: cleanedName, email: cleanedEmail, password })

    res.status(201).json(userResponse(user))
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

    const user = await User.findOne({ email: cleanedEmail })

    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH)
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    if (!(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid email or password' })
    }

    res.json(userResponse(user))
  } catch (error) {
    serverError(res, error, 'loginUser')
  }
}

export const getAllCustomers = async (req, res) => {
  try {
    const users = await User.find({ role: 'customer' }).select(
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

    const user = await User.findOne({ email })

    // Always respond the same way, so it can't be used to check which emails are registered
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex')
      user.resetToken = crypto.createHash('sha256').update(rawToken).digest('hex')
      user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000)
      await user.save()

      const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${rawToken}`
      sendPasswordReset(user, resetUrl).catch((e) => console.error('Reset email error:', e.message))
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

    if (!user) {
      return res.status(400).json({ message: 'This reset link is invalid or has expired' })
    }

    // Saving a new password also signs out every older session (see User.js)
    user.password = password
    user.resetToken = undefined
    user.resetTokenExpires = undefined
    await user.save()

    res.json(userResponse(user))
  } catch (error) {
    serverError(res, error, 'resetPassword')
  }
}