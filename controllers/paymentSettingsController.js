import axios from 'axios'
import User from '../models/User.js'
import { encrypt, decrypt, encryptionReady } from '../config/secretBox.js'
import {
  getPaymentConfig,
  resolvePaystack,
  clearPaystackCache,
  paystackApi,
} from '../utils/paystackConfig.js'
import { notifyAdminPaymentKeysChanged } from '../utils/email.js'
import { isString } from '../utils/validate.js'

// Paystack secret keys look like sk_test_xxxxxxxx or sk_live_xxxxxxxx
const KEY_PATTERNS = {
  test: /^sk_test_[A-Za-z0-9]{16,}$/,
  live: /^sk_live_[A-Za-z0-9]{16,}$/,
}

function serverError(res, error, where) {
  console.error(`${where} error:`, error)
  res.status(500).json({ message: 'Something went wrong. Please try again.' })
}

// Everything the admin page needs, and nothing secret: never the key itself,
// never the encrypted value, only whether one is saved and its last 4 characters.
async function buildStatus() {
  const config = await getPaymentConfig()
  const resolved = await resolvePaystack()

  return {
    mode: config.mode,
    test: { configured: Boolean(config.testSecretEnc), last4: config.testLast4 },
    live: { configured: Boolean(config.liveSecretEnc), last4: config.liveLast4 },
    activeSource: resolved.source, // 'dashboard' | 'environment' | 'none'
    activeMode: resolved.mode,
    problem: resolved.problem,
    environmentKeyPresent: Boolean(process.env.PAYSTACK_SECRET_KEY),
    encryptionReady: encryptionReady(),
    webhookPath: '/api/payments/webhook',
    updatedAt: config.updatedAt,
  }
}

export const getPaymentSettings = async (req, res) => {
  try {
    res.json(await buildStatus())
  } catch (error) {
    serverError(res, error, 'getPaymentSettings')
  }
}

export const updatePaymentSettings = async (req, res) => {
  try {
    if (!encryptionReady()) {
      return res.status(503).json({
        message:
          'Keys cannot be saved yet. Your developer needs to add SETTINGS_ENCRYPTION_KEY (32 or more random characters) on the server first.',
      })
    }

    const { password, mode, testSecretKey, liveSecretKey, removeTest, removeLive } = req.body

    // Re-check the password, so a stolen login session alone can't redirect payments
    if (!isString(password) || !password) {
      return res.status(400).json({ message: 'Enter your password to confirm this change' })
    }
    const user = await User.findById(req.user._id)
    if (!user || !(await user.matchPassword(password))) {
      return res.status(403).json({ message: 'That password is not correct' })
    }

    const config = await getPaymentConfig()
    const changes = []

    for (const [which, value] of [
      ['test', testSecretKey],
      ['live', liveSecretKey],
    ]) {
      if (value === undefined || value === null || value === '') continue

      const key = isString(value) ? value.trim() : ''
      if (!KEY_PATTERNS[which].test(key)) {
        return res.status(400).json({
          message: `That does not look like a Paystack ${which} secret key. It should start with sk_${which}_`,
        })
      }
      config[`${which}SecretEnc`] = encrypt(key)
      config[`${which}Last4`] = key.slice(-4)
      changes.push(`${which} key updated`)
    }

    if (removeTest) {
      config.testSecretEnc = ''
      config.testLast4 = ''
      changes.push('test key removed')
    }
    if (removeLive) {
      config.liveSecretEnc = ''
      config.liveLast4 = ''
      changes.push('live key removed')
    }

    if (mode !== undefined) {
      if (!['test', 'live'].includes(mode)) {
        return res.status(400).json({ message: 'Choose test or live mode' })
      }
      if (mode !== config.mode) changes.push(`switched to ${mode} mode`)
      config.mode = mode
    }

    // The mode in use must always have a key saved. The one exception is
    // removing the last saved key, which hands payments back to the
    // PAYSTACK_SECRET_KEY setting on the server.
    const chosenKey = config.mode === 'live' ? config.liveSecretEnc : config.testSecretEnc
    const anyKey = Boolean(config.testSecretEnc || config.liveSecretEnc)
    const removedLastKey = !anyKey && (removeTest || removeLive)
    if (!chosenKey && !removedLastKey) {
      return res.status(400).json({
        message: `Add your ${config.mode} secret key first, or switch to the other mode.`,
      })
    }

    if (changes.length === 0) {
      return res.status(400).json({ message: 'Nothing to change' })
    }

    config.updatedBy = req.user._id
    await config.save()
    clearPaystackCache()

    // Tell the owner, so a change they didn't make is noticed straight away
    notifyAdminPaymentKeysChanged({ by: user, changes }).catch((e) =>
      console.error('Payment change email error:', e.message)
    )

    res.json(await buildStatus())
  } catch (error) {
    serverError(res, error, 'updatePaymentSettings')
  }
}

// Asks Paystack whether a key is accepted. Tests the key in use, or a saved
// key by name ("test" or "live") so it can be checked before switching modes.
export const testPaystackConnection = async (req, res) => {
  try {
    const which = req.body?.which
    let secret
    let mode

    if (which === 'test' || which === 'live') {
      const config = await getPaymentConfig()
      const stored = which === 'live' ? config.liveSecretEnc : config.testSecretEnc
      if (!stored) {
        return res.status(400).json({ message: `No ${which} key is saved yet` })
      }
      if (!encryptionReady()) {
        return res.status(503).json({ message: 'SETTINGS_ENCRYPTION_KEY is missing on the server' })
      }
      secret = decrypt(stored)
      mode = which
    } else {
      const resolved = await resolvePaystack()
      if (!resolved.secret) {
        return res.status(400).json({ message: 'Paystack is not set up yet' })
      }
      secret = resolved.secret
      mode = resolved.mode
    }

    try {
      await axios.get(`${paystackApi()}/transaction`, {
        params: { perPage: 1 },
        headers: { Authorization: `Bearer ${secret}` },
        timeout: 10000,
      })
      res.json({ ok: true, mode })
    } catch (error) {
      if (error.response?.status === 401) {
        return res.json({
          ok: false,
          mode,
          message: 'Paystack did not accept this key. Check that it was copied in full.',
        })
      }
      res.json({ ok: false, mode, message: 'Could not reach Paystack. Please try again.' })
    }
  } catch (error) {
    serverError(res, error, 'testPaystackConnection')
  }
}