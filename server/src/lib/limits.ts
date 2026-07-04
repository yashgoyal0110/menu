import { getActivePlan } from '../config/plans.js'
import { db } from '../prisma.js'

export class PlanLimitError extends Error {
  code = 'PLAN_LIMIT' as const

  constructor(message: string) {
    super(message)
    this.name = 'PlanLimitError'
  }
}

/**
 * Enforce the location (store) limit for the user's active plan.
 * Ported from the Next.js app's src/lib/limits.ts.
 */
export async function ensureCanCreateStore(userId: string): Promise<void> {
  const [storeCount, subscription] = await Promise.all([
    db.store.count({ where: { userId } }),
    db.subscription.findUnique({ where: { userId } }),
  ])

  const plan = getActivePlan(subscription)

  if (storeCount >= plan.storeLimit) {
    const word = plan.storeLimit === 1 ? 'location' : 'locations'
    throw new PlanLimitError(
      `You reached the ${plan.name} plan limit (${plan.storeLimit} ${word}). Upgrade to Pro to create more.`,
    )
  }
}

/**
 * Enforce the per-store service (product) limit for the user's active plan.
 * Ported from the Next.js app's src/lib/limits.ts.
 */
export async function ensureCanCreateProducts(
  userId: string,
  storeId: string,
  count = 1,
): Promise<void> {
  const [productCount, subscription] = await Promise.all([
    db.product.count({ where: { storeId } }),
    db.subscription.findUnique({ where: { userId } }),
  ])

  const plan = getActivePlan(subscription)

  if (plan.productLimit === null) {
    return
  }

  if (productCount + count > plan.productLimit) {
    const remaining = Math.max(0, plan.productLimit - productCount)
    const serviceWord = count === 1 ? 'service' : 'services'
    const slotWord = remaining === 1 ? 'slot' : 'slots'
    throw new PlanLimitError(
      remaining > 0
        ? `This action adds ${count} ${serviceWord}, but your ${plan.name} plan has ${remaining} ${slotWord} left. Add fewer services or upgrade to Pro for unlimited services.`
        : `You reached the ${plan.name} plan limit (${plan.productLimit} services). Upgrade to Pro for unlimited services.`,
    )
  }
}
