// Same clean-up the server does when it starts (see utils/fixIndexes.js),
// for running by hand:  npm run fix-indexes
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import { fixOldIndexes } from '../utils/fixIndexes.js'

dotenv.config()
try {
  await mongoose.connect(process.env.MONGO_URI)
  const n = await fixOldIndexes()
  console.log(n ? `Done: removed ${n} old rule(s).` : 'Nothing to fix: the database is up to date.')
} catch (error) {
  console.error('Could not fix indexes:', error.message)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
