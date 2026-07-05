import { Router } from 'express'
import { z } from 'zod'

import { PRODUCT_CATEGORIES } from '../config/products.js'
import { ensureCanCreateProducts, PlanLimitError } from '../lib/limits.js'
import type { AuthedRequest } from '../middleware/auth.js'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../prisma.js'

const router = Router()

router.use(requireAuth)

const createProductSchema = z.object({
  name: z.string().min(1).max(120),
  price: z.coerce.number().int().nonnegative(),
  category: z.enum(PRODUCT_CATEGORIES),
  description: z.string().min(1),
  storeId: z.string().min(1),
})

const updateProductSchema = z.object({
  name: z.string().min(1).max(120),
  price: z.coerce.number().int().nonnegative(),
  category: z.enum(PRODUCT_CATEGORIES),
  description: z.string().min(1),
})

const listQuerySchema = z.object({
  storeId: z.string().min(1),
})

/** List products for a store the user owns. */
router.get('/', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const { storeId } = listQuerySchema.parse(req.query)

    const store = await db.store.findFirst({
      where: { id: storeId, userId },
    })
    if (!store) {
      res.status(404).json({ error: 'Location not found.' })
      return
    }

    const products = await db.product.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ products })
  } catch (err) {
    next(err)
  }
})

/** Create a product on a store the user owns, subject to plan limits. */
router.post('/', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const input = createProductSchema.parse(req.body)

    const store = await db.store.findFirst({
      where: { id: input.storeId, userId },
    })
    if (!store) {
      res.status(404).json({
        error:
          'Location not found or you do not have permission to add services.',
      })
      return
    }

    await ensureCanCreateProducts(userId, input.storeId, 1)

    const product = await db.product.create({
      data: {
        name: input.name,
        price: Number(input.price),
        category: input.category,
        description: input.description,
        storeId: input.storeId,
      },
    })
    res.status(201).json({ product })
  } catch (err) {
    if (err instanceof PlanLimitError) {
      res.status(403).json({ error: err.message, code: err.code })
      return
    }
    next(err)
  }
})

/** Update a product owned (through its store) by the user. */
router.patch('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const existing = await db.product.findFirst({
      where: { id: req.params.id },
      include: { store: true },
    })
    if (!existing || existing.store.userId !== userId) {
      res.status(404).json({ error: 'Service not found.' })
      return
    }

    const input = updateProductSchema.parse(req.body)
    const product = await db.product.update({
      where: { id: existing.id },
      data: {
        name: input.name,
        price: Number(input.price),
        category: input.category,
        description: input.description,
      },
    })
    res.json({ product })
  } catch (err) {
    next(err)
  }
})

/** Delete a product owned (through its store) by the user. */
router.delete('/:id', async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const existing = await db.product.findFirst({
      where: { id: req.params.id },
      include: { store: true },
    })
    if (!existing || existing.store.userId !== userId) {
      res.status(404).json({ error: 'Service not found.' })
      return
    }

    await db.product.delete({ where: { id: existing.id } })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
