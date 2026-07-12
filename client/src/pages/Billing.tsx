import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { CheckIcon, CreditCardIcon, SparklesIcon } from '../components/icons'
import { Alert, Badge, Button, Card, PageHead, Spinner } from '../components/ui'
import { useAuth } from '../context/auth'
import { api } from '../lib/api'

type PlanKey = 'BASIC' | 'PRO' | 'ENTERPRISE'
type PayableKey = 'PRO' | 'ENTERPRISE'

type UiState =
  | { kind: 'free' }
  | { kind: 'pending' }
  | { kind: 'active' }
  | { kind: 'cancelled-grace'; until: string }
  | { kind: 'cancelled-expired' }

type Plan = {
  planType: string
  name: string
  storeLimit: number
  productLimit: number | null
}

type SubscriptionResponse = {
  subscription: { status: string; planType: PlanKey } | null
  plan: Plan
  uiState: UiState
  usage: { storeCount: number; productCount: number }
}

const REFRESH_DELAY_MS = 5000
const WARN_THRESHOLD = 0.8
const PLAN_ORDER: PlanKey[] = ['BASIC', 'PRO', 'ENTERPRISE']

/**
 * Display copy for the plan cards. The *active* plan's limits come from the API
 * (env-configurable); these numbers are display fallbacks for the other cards.
 */
const PLAN_CATALOG: Record<
  PlanKey,
  {
    name: string
    description: string
    price: string
    priceHint: string
    storeLimit: number | null
    productLimit: number | null
    extras: string[]
    highlight?: boolean
  }
> = {
  BASIC: {
    name: 'Starter',
    description: 'For a single service location',
    price: 'Free',
    priceHint: 'forever',
    storeLimit: 5,
    productLimit: 25,
    extras: ['Public QR page'],
  },
  PRO: {
    name: 'Pro',
    description: 'For growing local service teams',
    price: '$15',
    priceHint: 'per month',
    storeLimit: 10,
    productLimit: null,
    extras: ['Public QR pages', 'Priority support'],
    highlight: true,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    description: 'For established multi-location businesses',
    price: '$49',
    priceHint: 'per month',
    storeLimit: 25,
    productLimit: null,
    extras: ['Public QR pages', 'Priority support & onboarding'],
  },
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value))
}

function limitLabel(kind: 'location' | 'service', limit: number | null): string {
  if (limit === null) {
    return kind === 'location' ? 'Unlimited locations' : 'Unlimited services'
  }
  const noun = kind === 'location' ? 'locations' : 'services'
  return `Up to ${limit} ${noun}`
}

/** A labelled usage meter: a track + a filled bar sized by inline width %. */
function UsageBar({
  label,
  noun,
  used,
  limit,
}: {
  label: string
  noun: string
  used: number
  limit: number | null
}) {
  const isUnlimited = limit === null
  const ratio = isUnlimited || limit === 0 ? 0 : used / limit
  const pct = Math.min(100, Math.round(ratio * 100))
  const isOver = !isUnlimited && used >= (limit ?? 0)
  const isNear = !isUnlimited && ratio >= WARN_THRESHOLD

  let fill = 'var(--brand-600)'
  if (isOver) {
    fill = 'var(--danger)'
  } else if (isNear) {
    fill = 'var(--warning)'
  }

  const summary = isUnlimited
    ? `${used} ${noun} · Unlimited`
    : `${used} of ${limit} ${noun}`

  return (
    <div className="stack-sm">
      <div className="row-between">
        <strong className="text-sm">{label}</strong>
        <span className="text-sm muted">{summary}</span>
      </div>
      <div
        aria-label={`${label} usage`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={isUnlimited ? 0 : pct}
        role="progressbar"
        style={{
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
          borderRadius: 999,
          height: 10,
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <div
          style={{
            background: isUnlimited ? 'var(--brand-200)' : fill,
            borderRadius: 999,
            height: '100%',
            transition: 'width 0.3s ease',
            width: isUnlimited ? '100%' : `${pct}%`,
          }}
        />
      </div>
    </div>
  )
}

export function Billing() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id')
  const justReturnedFromCheckout = Boolean(sessionId)

  const [data, setData] = useState<SubscriptionResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState<PayableKey | null>(null)
  const refreshedOnce = useRef(false)

  const load = useCallback(() => {
    const path = sessionId
      ? `/billing/subscription?session_id=${encodeURIComponent(sessionId)}`
      : '/billing/subscription'
    return api
      .get<SubscriptionResponse>(path)
      .then((res) => setData(res))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [sessionId])

  useEffect(() => {
    load()
  }, [load])

  // Return-from-checkout: if still PENDING, give the webhook a moment then refetch.
  useEffect(() => {
    if (
      justReturnedFromCheckout &&
      data?.uiState.kind === 'pending' &&
      !refreshedOnce.current
    ) {
      refreshedOnce.current = true
      const id = setTimeout(() => load(), REFRESH_DELAY_MS)
      return () => clearTimeout(id)
    }
  }, [justReturnedFromCheckout, data, load])

  const onSubscribe = async (planType: PayableKey) => {
    setError(null)
    if (!user?.email) {
      setError('No email address was found for your account')
      return
    }
    setWorking(planType)
    try {
      const res = await api.post<{ url: string }>('/billing/checkout', {
        planType,
      })
      if (!res.url) {
        throw new Error('No checkout link was returned')
      }
      window.location.href = res.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout')
      setWorking(null)
    }
  }

  const onCancel = async () => {
    setError(null)
    setWorking('PRO')
    try {
      await api.post('/billing/subscription/cancel')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel the subscription')
    } finally {
      setWorking(null)
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <PageHead subtitle="Manage your plan and usage" title="Billing" />
        <div className="row" style={{ justifyContent: 'center', padding: '2rem' }}>
          <Spinner />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="stack">
        <PageHead subtitle="Manage your plan and usage" title="Billing" />
        <Alert tone="error">{error ?? 'Failed to load billing information'}</Alert>
      </div>
    )
  }

  const { plan, uiState, usage, subscription } = data
  const showPendingBanner = uiState.kind === 'pending' && justReturnedFromCheckout
  // The plan a PENDING checkout is for (active plan is BASIC while pending).
  const pendingPlan =
    subscription?.status === 'PENDING' ? subscription.planType : null

  return (
    <div className="stack">
      <PageHead subtitle="Manage your plan and usage" title="Billing" />

      {error && <Alert tone="error">{error}</Alert>}

      {showPendingBanner && (
        <Alert tone="info">
          <div className="stack-sm">
            <strong>Confirming your subscription…</strong>
            <span>
              Waiting for payment confirmation. This can take a few seconds — the
              page updates automatically.
            </span>
          </div>
        </Alert>
      )}

      <Card>
        <div className="card-header">
          <div className="row">
            <CreditCardIcon />
            <h2>Usage</h2>
          </div>
          <Badge tone="brand">{plan.name} plan</Badge>
        </div>
        <div className="card-body stack">
          <UsageBar
            label="Locations"
            limit={plan.storeLimit}
            noun="locations"
            used={usage.storeCount}
          />
          <UsageBar
            label="Services"
            limit={plan.productLimit}
            noun="services"
            used={usage.productCount}
          />
        </div>
      </Card>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}
      >
        {PLAN_ORDER.map((planKey) => (
          <PlanCard
            active={plan}
            key={planKey}
            onCancel={onCancel}
            onSubscribe={onSubscribe}
            pendingPlan={pendingPlan}
            planKey={planKey}
            uiState={uiState}
            working={working}
          />
        ))}
      </div>
    </div>
  )
}

function PlanFeatures({ items }: { items: string[] }) {
  return (
    <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {items.map((item) => (
        <li className="row text-sm" key={item}>
          <span style={{ color: 'var(--success)', display: 'inline-flex' }}>
            <CheckIcon size={16} />
          </span>
          {item}
        </li>
      ))}
    </ul>
  )
}

function PlanCard({
  planKey,
  active,
  uiState,
  pendingPlan,
  working,
  onSubscribe,
  onCancel,
}: {
  planKey: PlanKey
  active: Plan
  uiState: UiState
  pendingPlan: PlanKey | null
  working: PayableKey | null
  onSubscribe: (planType: PayableKey) => void
  onCancel: () => void
}) {
  const catalog = PLAN_CATALOG[planKey]
  const isCurrent = active.planType === planKey

  const storeLimit = isCurrent ? active.storeLimit : catalog.storeLimit
  const productLimit = isCurrent ? active.productLimit : catalog.productLimit

  const features = [
    limitLabel('location', storeLimit),
    limitLabel('service', productLimit),
    ...catalog.extras,
  ]

  return (
    <Card
      className={
        catalog.highlight ? 'card' : undefined
      }
    >
      <div
        className="card-body stack"
        style={
          catalog.highlight
            ? { borderTop: '3px solid var(--brand-600)', borderRadius: 'inherit' }
            : undefined
        }
      >
        <div className="row-between">
          <div className="row">
            {planKey !== 'BASIC' && (
              <span style={{ color: 'var(--brand-600)', display: 'inline-flex' }}>
                <SparklesIcon />
              </span>
            )}
            <h2>{catalog.name}</h2>
          </div>
          {isCurrent && <Badge tone="success">Current plan</Badge>}
        </div>

        <p className="muted text-sm">{catalog.description}</p>

        <div className="row" style={{ alignItems: 'baseline', gap: '0.4rem' }}>
          <span style={{ fontSize: '1.6rem', fontWeight: 700 }}>{catalog.price}</span>
          <span className="muted text-sm">{catalog.priceHint}</span>
        </div>

        <PlanFeatures items={features} />

        {planKey !== 'BASIC' && (
          <PayableCardAction
            isCurrent={isCurrent}
            isPending={pendingPlan === planKey}
            onCancel={onCancel}
            onSubscribe={onSubscribe}
            planKey={planKey}
            planName={catalog.name}
            uiState={uiState}
            working={working}
          />
        )}
      </div>
    </Card>
  )
}

function PayableCardAction({
  planKey,
  planName,
  isCurrent,
  isPending,
  uiState,
  working,
  onSubscribe,
  onCancel,
}: {
  planKey: PayableKey
  planName: string
  isCurrent: boolean
  isPending: boolean
  uiState: UiState
  working: PayableKey | null
  onSubscribe: (planType: PayableKey) => void
  onCancel: () => void
}) {
  // A pending checkout for THIS plan.
  if (isPending) {
    return (
      <div className="stack-sm">
        <Button block disabled variant="primary">
          Awaiting confirmation…
        </Button>
        <Alert tone="info">
          Your payment is being confirmed. This page updates automatically once
          the payment is processed.
        </Alert>
      </div>
    )
  }

  // This is the user's active plan.
  if (isCurrent && uiState.kind === 'active') {
    return (
      <Button
        block
        loading={working === 'PRO'}
        onClick={onCancel}
        variant="secondary"
      >
        Cancel subscription
      </Button>
    )
  }

  if (isCurrent && uiState.kind === 'cancelled-grace') {
    return (
      <div className="stack-sm">
        <Alert tone="info">
          Your {planName} access stays active until {formatDate(uiState.until)}.
        </Alert>
        <Button
          block
          loading={working === planKey}
          onClick={() => onSubscribe(planKey)}
          variant="primary"
        >
          Re-subscribe
        </Button>
      </div>
    )
  }

  // Any other plan the user could move to.
  return (
    <Button
      block
      loading={working === planKey}
      onClick={() => onSubscribe(planKey)}
      variant={planKey === 'PRO' ? 'primary' : 'secondary'}
    >
      Choose {planName}
    </Button>
  )
}
