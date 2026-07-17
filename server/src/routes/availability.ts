import { Router } from 'express'
import { z } from 'zod'

import { availabilitySnapshot } from '../lib/availability.js'
import type { AuthedRequest } from '../middleware/auth.js'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../prisma.js'

const router = Router()
router.use(requireAuth)

const minute = z.number().int().min(0).max(1440)
const timezone = z.string().min(1).refine((value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
}, 'Choose a valid timezone.')
const hoursSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isClosed: z.boolean(),
  openMinute: minute,
  closeMinute: minute,
}).refine((value) => value.isClosed || value.openMinute !== value.closeMinute, 'Opening and closing times must differ.')
const settingsSchema = z.object({
  enabled: z.boolean(),
  timezone,
  hours: z.array(hoursSchema).length(7),
})
const resourceObjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  singularLabel: z.string().trim().min(1).max(40),
  totalCapacity: z.number().int().min(1).max(10000),
  availableNow: z.number().int().min(0).max(10000),
})
const resourceSchema = resourceObjectSchema.refine((value) => value.availableNow <= value.totalCapacity, 'Available capacity cannot exceed total capacity.')
const resourceUpdateSchema = resourceObjectSchema.partial().extend({ active: z.boolean().optional() })
const exceptionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isClosed: z.boolean(),
  openMinute: minute.nullable(),
  closeMinute: minute.nullable(),
  note: z.string().trim().max(120).nullable(),
}).refine((value) => value.isClosed || (value.openMinute !== null && value.closeMinute !== null && value.openMinute !== value.closeMinute), 'Special hours require different opening and closing times.')

async function ownedStore(storeId: string, userId?: string) {
  return db.store.findFirst({ where: { id: storeId, userId, deletedAt: null } })
}

const availabilityInclude = {
  businessHours: { orderBy: { dayOfWeek: 'asc' as const } },
  availabilityResources: { where: { active: true }, orderBy: { createdAt: 'asc' as const } },
  availabilityExceptions: { orderBy: { date: 'asc' as const } },
}

router.get('/stores/:storeId', async (req: AuthedRequest, res, next) => {
  try {
    const store = await db.store.findFirst({
      where: { id: req.params.storeId, userId: req.auth?.userId, deletedAt: null },
      include: availabilityInclude,
    })
    if (!store) { res.status(404).json({ error: 'Location not found.' }); return }
    res.json({
      availability: {
        enabled: store.availabilityEnabled,
        timezone: store.timezone,
        hours: store.businessHours,
        resources: store.availabilityResources,
        exceptions: store.availabilityExceptions,
        snapshot: availabilitySnapshot(store),
      },
    })
  } catch (error) { next(error) }
})

router.put('/stores/:storeId', async (req: AuthedRequest, res, next) => {
  try {
    const store = await ownedStore(req.params.storeId, req.auth?.userId)
    if (!store) { res.status(404).json({ error: 'Location not found.' }); return }
    const input = settingsSchema.parse(req.body)
    await db.$transaction([
      db.store.update({ where: { id: store.id }, data: { availabilityEnabled: input.enabled, timezone: input.timezone } }),
      ...input.hours.map((hour) => db.businessHour.upsert({
        where: { storeId_dayOfWeek: { storeId: store.id, dayOfWeek: hour.dayOfWeek } },
        create: { storeId: store.id, ...hour },
        update: hour,
      })),
    ])
    res.json({ ok: true })
  } catch (error) { next(error) }
})

router.post('/stores/:storeId/resources', async (req: AuthedRequest, res, next) => {
  try {
    const store = await ownedStore(req.params.storeId, req.auth?.userId)
    if (!store) { res.status(404).json({ error: 'Location not found.' }); return }
    const input = resourceSchema.parse(req.body)
    const resource = await db.availabilityResource.create({ data: { storeId: store.id, ...input } })
    res.status(201).json({ resource })
  } catch (error) { next(error) }
})

router.patch('/stores/:storeId/resources/:resourceId', async (req: AuthedRequest, res, next) => {
  try {
    const store = await ownedStore(req.params.storeId, req.auth?.userId)
    if (!store) { res.status(404).json({ error: 'Location not found.' }); return }
    const existing = await db.availabilityResource.findFirst({ where: { id: req.params.resourceId, storeId: store.id } })
    if (!existing) { res.status(404).json({ error: 'Capacity pool not found.' }); return }
    const input = resourceUpdateSchema.parse(req.body)
    const totalCapacity = input.totalCapacity ?? existing.totalCapacity
    const availableNow = input.availableNow ?? existing.availableNow
    if (availableNow > totalCapacity) { res.status(400).json({ error: 'Available capacity cannot exceed total capacity.' }); return }
    const resource = await db.availabilityResource.update({ where: { id: existing.id }, data: input })
    res.json({ resource })
  } catch (error) { next(error) }
})

router.delete('/stores/:storeId/resources/:resourceId', async (req: AuthedRequest, res, next) => {
  try {
    const store = await ownedStore(req.params.storeId, req.auth?.userId)
    if (!store) { res.status(404).json({ error: 'Location not found.' }); return }
    const result = await db.availabilityResource.deleteMany({ where: { id: req.params.resourceId, storeId: store.id } })
    if (!result.count) { res.status(404).json({ error: 'Capacity pool not found.' }); return }
    res.json({ ok: true })
  } catch (error) { next(error) }
})

router.post('/stores/:storeId/exceptions', async (req: AuthedRequest, res, next) => {
  try {
    const store = await ownedStore(req.params.storeId, req.auth?.userId)
    if (!store) { res.status(404).json({ error: 'Location not found.' }); return }
    const input = exceptionSchema.parse(req.body)
    const date = new Date(`${input.date}T00:00:00.000Z`)
    const exception = await db.availabilityException.upsert({
      where: { storeId_date: { storeId: store.id, date } },
      create: { storeId: store.id, ...input, date },
      update: { ...input, date },
    })
    res.json({ exception })
  } catch (error) { next(error) }
})

router.delete('/stores/:storeId/exceptions/:exceptionId', async (req: AuthedRequest, res, next) => {
  try {
    const store = await ownedStore(req.params.storeId, req.auth?.userId)
    if (!store) { res.status(404).json({ error: 'Location not found.' }); return }
    await db.availabilityException.deleteMany({ where: { id: req.params.exceptionId, storeId: store.id } })
    res.json({ ok: true })
  } catch (error) { next(error) }
})

export default router
