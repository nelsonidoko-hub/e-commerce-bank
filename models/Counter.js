import mongoose from 'mongoose'

// One counter per shop and purpose. _id is "<storeId>:<name>", e.g. "64f...:order",
// so every shop's order numbers start at their own 10001.
const counterSchema = new mongoose.Schema({
  _id: String,
  seq: Number,
})

export default mongoose.model('Counter', counterSchema)