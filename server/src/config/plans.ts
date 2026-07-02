import { env } from '../env.js'

/**
 * Plan catalog. All location limits are env-configurable (validated in env.ts):
 *   FREE_PLAN_STORE_LIMIT       (default 5)
 *   FREE_PLAN_PRODUCT_LIMIT     (default 25)
 *   PRO_PLAN_STORE_LIMIT        (default 10)
 *   ENTERPRISE_PLAN_STORE_LIMIT (default 25)
 * Paid tiers get unlimited services (productLimit: null). Prices are in USD/mo
 * and drive the Stripe checkout amount (price * 100 cents).
 */
const FREE_PLAN_STORE_LIMIT = env.FREE_PLAN_STORE_LIMIT
const FREE_PLAN_PRODUCT_LIMIT = env.FREE_PLAN_PRODUCT_LIMIT
const PRO_PLAN_STORE_LIMIT = env.PRO_PLAN_STORE_LIMIT
const ENTERPRISE_PLAN_STORE_LIMIT = env.ENTERPRISE_PLAN_STORE_LIMIT

const locationWord = (n: number) => (n === 1 ? 'location' : 'locations')

export type PlanType = 'BASIC' | 'PRO' | 'ENTERPRISE'

export type Plan = {
  planType: PlanType
  name: string
  slug: string
  description: string
  priceUsd: number
  storeLimit: number
  productLimit: number | null
  features: string[]
}

export const PLANS: Plan[] = [
  {
    planType: 'BASIC',
    name: 'Starter',
    slug: 'gratis',
    description: 'For a single service location',
    priceUsd: 0,
    storeLimit: FREE_PLAN_STORE_LIMIT,
    productLimit: FREE_PLAN_PRODUCT_LIMIT,
    features: [
      `${FREE_PLAN_STORE_LIMIT} ${locationWord(FREE_PLAN_STORE_LIMIT)}`,
      `Up to ${FREE_PLAN_PRODUCT_LIMIT} services`,
      'Public QR page',
    ],
  },
  {
    planType: 'PRO',
    name: 'Pro',
    slug: 'pro',
    description: 'For growing local service teams',
    priceUsd: 15,
    storeLimit: PRO_PLAN_STORE_LIMIT,
    productLimit: null,
    features: [
      `Up to ${PRO_PLAN_STORE_LIMIT} ${locationWord(PRO_PLAN_STORE_LIMIT)}`,
      'Unlimited services',
      'Public QR pages',
      'Priority support',
    ],
  },
  {
    planType: 'ENTERPRISE',
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'For established multi-location businesses',
    priceUsd: 49,
    storeLimit: ENTERPRISE_PLAN_STORE_LIMIT,
    productLimit: null,
    features: [
      `Up to ${ENTERPRISE_PLAN_STORE_LIMIT} ${locationWord(ENTERPRISE_PLAN_STORE_LIMIT)}`,
      'Unlimited services',
      'Public QR pages',
      'Priority support & onboarding',
    ],
  },
]

/** Plan types users can pay for (everything except the free tier). */
export const PAYABLE_PLAN_TYPES = ['PRO', 'ENTERPRISE'] as const
export type PayablePlanType = (typeof PAYABLE_PLAN_TYPES)[number]

export function isPayablePlanType(value: string): value is PayablePlanType {
  return (PAYABLE_PLAN_TYPES as readonly string[]).includes(value)
}

const BASIC_PLAN = PLANS.find((p) => p.planType === 'BASIC')

if (!BASIC_PLAN) {
  throw new Error('BASIC plan missing from PLANS config')
}

export function getPlan(planType: string): Plan {
  return PLANS.find((p) => p.planType === planType) ?? (BASIC_PLAN as Plan)
}

type SubscriptionLike = {
  status: string
  planType: string
  currentPeriodEnd: Date | null
} | null

/**
 * The plan a user is entitled to right now. Cancelled subscriptions stay on
 * their paid plan until currentPeriodEnd (grace period).
 */
export function getActivePlan(subscription: SubscriptionLike): Plan {
  if (!subscription) {
    return BASIC_PLAN as Plan
  }

  const inGracePeriod =
    subscription.status === 'CANCELLED' &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd > new Date()

  const entitled = subscription.status === 'ACTIVE' || inGracePeriod

  return entitled ? getPlan(subscription.planType) : (BASIC_PLAN as Plan)
}

/**
 * Discriminated UI state for the billing page Pro card.
 * Ported from the Next.js app's src/lib/subscription.ts.
 */
export type SubscriptionUiState =
  | { kind: 'free' }
  | { kind: 'pending' }
  | { kind: 'active' }
  | { kind: 'cancelled-grace'; until: Date }
  | { kind: 'cancelled-expired' }

export function getSubscriptionUiState(
  subscription: SubscriptionLike,
): SubscriptionUiState {
  if (!subscription || subscription.status === 'INACTIVE') {
    return { kind: 'free' }
  }

  if (subscription.status === 'PENDING') {
    return { kind: 'pending' }
  }

  if (subscription.status === 'ACTIVE') {
    return { kind: 'active' }
  }

  if (subscription.status === 'CANCELLED' && subscription.currentPeriodEnd) {
    return subscription.currentPeriodEnd > new Date()
      ? { kind: 'cancelled-grace', until: subscription.currentPeriodEnd }
      : { kind: 'cancelled-expired' }
  }

  return { kind: 'free' }
}
