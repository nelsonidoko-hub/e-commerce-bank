// Creates (or refreshes) one live demo shop per template, filled with sample
// products, for the Templates gallery: demo-classic, demo-fresh, demo-tech ...
// They belong to the platform owner's account, are always open, and refuse orders.
//
//   node scripts/seedDemos.js
//
// Needs PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD in .env (the platform
// owner's own account; created the first time). Safe to run again: existing
// demos are rebuilt with fresh sample content.
import dotenv from 'dotenv'
import mongoose from 'mongoose'
import Store from '../models/Store.js'
import User from '../models/User.js'
import Product from '../models/Product.js'
import Category from '../models/Category.js'
import HeroSlide from '../models/HeroSlide.js'
import Settings from '../models/Settings.js'
import Page from '../models/Page.js'
import { createShop } from '../utils/createShop.js'
import { BUILTIN_TEMPLATES, refreshTemplates, publishedStudioTemplates } from '../utils/templates.js'
import { storeUrl } from '../utils/storeUrl.js'

dotenv.config()

const NAMES = {
  classic: 'Classic Demo Shop',
  minimal: 'Atelier Demo',
  bold: 'Street Demo',
  fresh: "Mama's Kitchen Demo",
  catalog: 'Mega Mart Demo',
  glow: 'Glow Beauty Demo',
  tech: 'Gadget Hub Demo',
  playful: 'Little Ones Demo',
  gadget: 'Gadget Hub Demo',
  atelier: 'Atelier Demo',
  furnish: 'Furnish Home Demo',
  bloom: 'Bloom Sneakers Demo',
}

// (Re)builds one template's demo shop, demo-<template>, from scratch
export async function remakeDemo(owner, template, name) {
  const slug = `demo-${template}`
  const old = await Store.findOne({ slug })
  if (old) {
    for (const model of [Product, Category, HeroSlide, Settings, Page]) await model.deleteMany({ store: old._id })
    await Store.deleteOne({ _id: old._id })
  }
  return createShop({ owner, name, slug, template, plan: 'pro', isDemo: true })
}

export async function seedDemos({ email, password, log = console.log }) {
  email = String(email || '').trim().toLowerCase()
  if (!email) throw new Error('Set PLATFORM_ADMIN_EMAIL')

  let owner = await User.findOne({ store: null, email })
  if (!owner) {
    if (!password || password.length < 12) throw new Error('Set PLATFORM_ADMIN_PASSWORD (12+ characters) to create the platform account')
    owner = await User.create({ store: null, role: 'superadmin', name: 'Platform', email, password })
    log(`Founder account created: ${email}`)
  } else if (owner.role !== 'superadmin') {
    // The email already has an account (an old store admin, or a shop you
    // signed up for): make it the founder. Its password stays the same.
    await User.updateOne({ _id: owner._id }, { $set: { role: 'superadmin' } })
    owner.role = 'superadmin'
    log(`${email} already had an account. It is now the founder account (same password as before).`)
  } else {
    log(`Founder account already set up: ${email}`)
  }

  const made = []
  await refreshTemplates()
  const studioNames = Object.fromEntries(publishedStudioTemplates().filter((t) => !t.builtIn).map((t) => [t.id, `${t.label} demo`]))
  for (const template of [...BUILTIN_TEMPLATES, ...Object.keys(studioNames)]) {
    const store = await remakeDemo(owner, template, NAMES[template] || studioNames[template] || `${template} demo`)
    made.push(store)
    log(`${template.padEnd(8)} ${storeUrl(store)}`)
  }
  return made
}

if (process.argv[1]?.endsWith('seedDemos.js')) {
  try {
    await mongoose.connect(process.env.MONGO_URI)
    await seedDemos({ email: process.env.PLATFORM_ADMIN_EMAIL, password: process.env.PLATFORM_ADMIN_PASSWORD })
  } catch (error) {
    console.error('Could not create the demo shops:', error.message)
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}
