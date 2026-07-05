import { Router } from 'express'
import { z } from 'zod'

import { ensureCanCreateStore, PlanLimitError } from '../lib/limits.js'
import type { AuthedRequest } from '../middleware/auth.js'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../prisma.js'

const router = Router()

router.use(requireAuth)

/**
 * Phase 1: address/geo fields are accepted directly in the body. The Mapbox
 * search-and-retrieve flow from the Next.js app is a later migration phase.
 */
// E.164: a leading +, country code (1-9), then 6-14 more digits.
const E164_PHONE = /^\+[1-9]\d{6,14}$/

const createStoreSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1),
  address: z.string().min(1),
  citySlug: z.string().min(1),
  cityName: z.string().min(1),
  province: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  phone: z
    .string()
    .regex(E164_PHONE, 'Enter a valid phone number including country code.'),
})

const updateStoreSchema = createStoreSchema.partial()

router.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const stores = await db.store.findMany({
      where: { userId: req.auth?.userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ stores })
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    // Enforce the plan location limit (env-configurable, default 5).
    await ensureCanCreateStore(userId)

    const input = createStoreSchema.parse(req.body)

    const nameTaken = await db.store.findUnique({ where: { name: input.name } })
    if (nameTaken) {
      res.status(409).json({ error: 'A location with that name already exists.' })
      return
    }

    const store = await db.store.create({
      data: { ...input, userId },
    })
    res.status(201).json({ store })
  } catch (err) {
    if (err instanceof PlanLimitError) {
      res.status(403).json({ error: err.message, code: err.code })
      return
    }
    next(err)
  }
})

router.get('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const store = await db.store.findFirst({
      where: { id: req.params.id, userId: req.auth?.userId },
      include: { logo: true, banner: true },
    })
    if (!store) {
      res.status(404).json({ error: 'Location not found.' })
      return
    }
    res.json({ store })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await db.store.findFirst({
      where: { id: req.params.id, userId: req.auth?.userId },
    })
    if (!existing) {
      res.status(404).json({ error: 'Location not found.' })
      return
    }

    const input = updateStoreSchema.parse(req.body)
    const store = await db.store.update({
      where: { id: existing.id },
      data: input,
    })
    res.json({ store })
  } catch (err) {
    next(err)
  }
})

router.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const existing = await db.store.findFirst({
      where: { id: req.params.id, userId: req.auth?.userId },
    })
    if (!existing) {
      res.status(404).json({ error: 'Location not found.' })
      return
    }
    await db.product.deleteMany({ where: { storeId: existing.id } })
    await db.store.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
