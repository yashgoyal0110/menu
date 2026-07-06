import type { Request, Response } from 'express'
import { Router } from 'express'
import type Stripe from 'stripe'

import {
  getActivePlan,
  getPlan,
  getSubscriptionUiState,
  isPayablePlanType,
  type PayablePlanType,
} from '../config/plans.js'
import type { AuthedRequest } from '../middleware/auth.js'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../prisma.js'
import {
  APP_URL,
  lineItemForPlan,
  periodEnd,
  periodStart,
  stripe,
  STRIPE_WEBHOOK_SECRET,
} from '../lib/stripe.js'

const router = Router()

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

type LocalStatus = 'ACTIVE' | 'CANCELLED' | 'PENDING'

/** Maps a Stripe subscription to our local SubscriptionStatus. */
function mapStatus(sub: Stripe.Subscription): LocalStatus {
  if (sub.status === 'active' || sub.status === 'trialing') {
    // Scheduled to end: keep entitlement until the period end (grace).
    return sub.cancel_at_period_end ? 'CANCELLED' : 'ACTIVE'
  }
  if (sub.status === 'canceled') {
    return 'CANCELLED'
  }
  return 'PENDING'
}

const customerId = (sub: Stripe.Subscription): string | undefined =>
  typeof sub.customer === 'string' ? sub.customer : sub.customer?.id

/**
 * Reflect a Stripe subscription into our DB. userId comes from the
 * subscription metadata (set at checkout); a fallback may be supplied for the
 * checkout.session.completed event.
 */
async function applyStripeSubscription(
  sub: Stripe.Subscription,
  fallbackUserId?: string,
): Promise<void> {
  const userId = sub.metadata?.userId ?? fallbackUserId
  if (!userId) {
    console.warn('[STRIPE] subscription without userId metadata', sub.id)
    return
  }

  const metaPlan = sub.metadata?.planType
  const planType: PayablePlanType =
    metaPlan && isPayablePlanType(metaPlan) ? metaPlan : 'PRO'

  const data = {
    planType,
    status: mapStatus(sub),
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId(sub),
    currentPeriodStart: periodStart(sub),
    currentPeriodEnd: periodEnd(sub),
    nextPaymentDate: periodEnd(sub),
  }

  await db.subscription.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  })
}

/* -------------------------------------------------------------------------- */
/* GET /subscription — current subscription + plan + usage                      */
/* -------------------------------------------------------------------------- */

router.get('/subscription', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const userId = req.auth?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    // Just returned from Checkout (?session_id=...): eagerly reflect the result
    // instead of waiting on the webhook. Best-effort.
    const sessionId =
      typeof req.query.session_id === 'string' ? req.query.session_id : undefined
    if (sessionId && stripe) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId)
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            session.subscription as string,
          )
          await applyStripeSubscription(
            sub,
            (session.client_reference_id as string) ?? userId,
          )
        }
      } catch (err) {
        console.error('[STRIPE] eager session refresh failed', err)
      }
    }

    const [storeCount, productCount, subscription] = await Promise.all([
      db.store.count({ where: { userId } }),
      db.product.count({ where: { store: { userId } } }),
      db.subscription.findUnique({ where: { userId } }),
    ])

    res.json({
      subscription,
      plan: getActivePlan(subscription),
      uiState: getSubscriptionUiState(subscription),
      usage: { storeCount, productCount },
    })
  } catch (err) {
    next(err)
  }
})

/* -------------------------------------------------------------------------- */
/* POST /checkout — create a Stripe Checkout Session for Pro                     */
/* -------------------------------------------------------------------------- */

router.post('/checkout', requireAuth, async (req: AuthedRequest, res) => {
  try {
    const userId = req.auth?.userId
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    if (!stripe) {
      res.status(500).json({ error: 'Billing is not configured.' })
      return
    }

    // Which plan to buy (defaults to PRO). Must be a payable tier.
    const requested =
      typeof req.body?.planType === 'string' ? req.body.planType : 'PRO'
    if (!isPayablePlanType(requested)) {
      res.status(400).json({ error: 'Invalid plan.' })
      return
    }
    const plan = getPlan(requested)

    const user = await db.user.findUnique({ where: { userId } })
    const email = user?.email
    if (!email) {
      res.status(400).json({ error: 'No email on file for this account.' })
      return
    }

    const existing = await db.subscription.findUnique({ where: { userId } })

    // Reuse a Stripe customer across checkouts so history stays on one profile.
    let stripeCustomerId = existing?.stripeCustomerId ?? undefined
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { userId },
      })
      stripeCustomerId = customer.id
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [lineItemForPlan(plan.name, plan.priceUsd)],
      client_reference_id: userId,
      subscription_data: { metadata: { userId, planType: plan.planType } },
      success_url: `${APP_URL}/dashboard/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/dashboard/billing`,
    })

    // Record intent locally so the UI can show "pending" immediately.
    await db.subscription.upsert({
      where: { userId },
      update: { planType: plan.planType, status: 'PENDING', stripeCustomerId },
      create: {
        userId,
        planType: plan.planType,
        status: 'PENDING',
        stripeCustomerId,
      },
    })

    res.json({ url: session.url })
  } catch (err) {
    console.error('[STRIPE_CHECKOUT_ERROR]', err)
    res.status(500).json({ error: 'Could not start checkout. Please try again.' })
  }
})

/* -------------------------------------------------------------------------- */
/* POST /subscription/cancel — cancel at period end (keeps grace period)        */
/* -------------------------------------------------------------------------- */

router.post(
  '/subscription/cancel',
  requireAuth,
  async (req: AuthedRequest, res) => {
    try {
      const userId = req.auth?.userId
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }
      if (!stripe) {
        res.status(500).json({ error: 'Billing is not configured.' })
        return
      }

      const subscription = await db.subscription.findUnique({
        where: { userId },
      })
      if (!subscription?.stripeSubscriptionId) {
        res.status(404).json({ error: 'No active subscription was found.' })
        return
      }
      if (subscription.status !== 'ACTIVE') {
        res.status(409).json({
          error: 'This subscription cannot be cancelled in its current state.',
        })
        return
      }

      // Cancel at period end → user keeps Pro until currentPeriodEnd (grace).
      const updated = await stripe.subscriptions.update(
        subscription.stripeSubscriptionId,
        { cancel_at_period_end: true },
      )

      // Reflect immediately; the webhook confirms.
      await applyStripeSubscription(updated, userId)

      res.json({ success: true })
    } catch (err) {
      console.error('[STRIPE_CANCEL_ERROR]', err)
      res.status(500).json({
        error: 'Could not cancel the subscription. Please try again.',
      })
    }
  },
)

export default router

/* -------------------------------------------------------------------------- */
/* Stripe webhook handler — mounted in index.ts with a RAW body (NO auth)       */
/* -------------------------------------------------------------------------- */

async function recordInvoicePayment(invoice: Stripe.Invoice): Promise<void> {
  const subId =
    typeof invoice.subscription === 'string' ? invoice.subscription : undefined
  if (!(invoice.id && subId)) {
    return
  }
  const local = await db.subscription.findUnique({
    where: { stripeSubscriptionId: subId },
  })
  if (!local) {
    return
  }
  await db.payment.upsert({
    where: { paymentId: invoice.id },
    update: { status: invoice.status ?? 'paid' },
    create: {
      paymentId: invoice.id,
      provider: 'stripe',
      userId: local.userId,
      subscriptionId: local.id,
      status: invoice.status ?? 'paid',
      amount: (invoice.amount_paid ?? 0) / 100,
      currency: invoice.currency ?? undefined,
    },
  })
}

export async function stripeWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!(stripe && STRIPE_WEBHOOK_SECRET)) {
    // Not fully configured — acknowledge so Stripe doesn't retry endlessly.
    console.warn('[STRIPE_WEBHOOK] not configured; ignoring event')
    res.json({ received: true })
    return
  }

  const signature = req.headers['stripe-signature']
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      signature as string,
      STRIPE_WEBHOOK_SECRET,
    )
  } catch (err) {
    console.warn('[STRIPE_WEBHOOK] signature verification failed', err)
    res.status(400).send('invalid signature')
    return
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            session.subscription as string,
          )
          await applyStripeSubscription(
            sub,
            (session.client_reference_id as string) ?? undefined,
          )
        }
        break
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await applyStripeSubscription(event.data.object as Stripe.Subscription)
        break
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        await recordInvoicePayment(invoice)
        if (typeof invoice.subscription === 'string') {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription)
          await applyStripeSubscription(sub)
        }
        break
      }
      default:
        break
    }
    res.json({ received: true })
  } catch (err) {
    console.error('[STRIPE_WEBHOOK_HANDLER_ERROR]', err)
    // Acknowledge to avoid retry storms; page-load reconcile recovers state.
    res.json({ received: true })
  }
}
