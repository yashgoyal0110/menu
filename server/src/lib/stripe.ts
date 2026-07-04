import Stripe from 'stripe'

/**
 * Stripe billing. Runs in TEST MODE when you use test keys (sk_test_… /
 * whsec_…) — the checkout, cards, and webhooks are fully real, but no money
 * moves. Use card 4242 4242 4242 4242, any future expiry, any CVC.
 *
 * All config comes from env; when STRIPE_SECRET_KEY is unset, billing endpoints
 * report "not configured" and the rest of the app keeps working.
 */

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET

// Public origin used for Checkout success/cancel redirects.
export const APP_URL =
  process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:5173'

export const STRIPE_CURRENCY = (process.env.STRIPE_CURRENCY ?? 'usd').toLowerCase()

export const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null

/**
 * Builds an inline recurring line item for a plan from its USD monthly price,
 * so no Stripe dashboard Product/Price setup is needed.
 */
export function lineItemForPlan(
  name: string,
  priceUsd: number,
): Stripe.Checkout.SessionCreateParams.LineItem {
  return {
    quantity: 1,
    price_data: {
      currency: STRIPE_CURRENCY,
      unit_amount: Math.round(priceUsd * 100),
      recurring: { interval: 'month' },
      product_data: { name: `ServiceDock ${name}` },
    },
  }
}

const secToDate = (seconds?: number | null) =>
  seconds ? new Date(seconds * 1000) : undefined

export function periodEnd(sub: Stripe.Subscription): Date | undefined {
  return secToDate(sub.current_period_end)
}

export function periodStart(sub: Stripe.Subscription): Date | undefined {
  return secToDate(sub.current_period_start)
}
