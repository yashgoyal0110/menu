import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  DownloadIcon,
  MapPinIcon,
  PhoneIcon,
  SparklesIcon,
  StoreIcon,
} from '../components/icons'
import { Alert, Button, Card, EmptyState, Spinner } from '../components/ui'
import { api } from '../lib/api'
import '../styles/public.css'

const PRODUCT_CATEGORIES = ['Repairs', 'Plans', 'AddOns'] as const
type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

// Presentation labels ported from product-list.tsx CATEGORY_LABELS.
const CATEGORY_LABELS: Record<ProductCategory, string> = {
  Repairs: 'Repairs',
  Plans: 'Plans',
  AddOns: 'Add-ons',
}

type PublicProduct = {
  id: string
  name: string
  price: number
  description: string
  category: ProductCategory
}

type PublicStoreData = {
  id: string
  name: string
  slug: string | null
  description: string
  address: string
  citySlug: string
  cityName: string
  province: string
  phone: string
  logoUrl: string | null
  bannerUrl: string | null
  availability: {
    enabled: boolean
    status: 'NOT_CONFIGURED' | 'CLOSED' | 'FULL' | 'AVAILABLE'
    timezone: string
    schedule?: { isClosed: boolean; openMinute: number | null; closeMinute: number | null; special: boolean; note: string | null }
    lastUpdated?: string | null
    resources: Array<{ id: string; name: string; singularLabel: string; totalCapacity: number; availableNow: number }>
  }
  products: PublicProduct[]
}

const formatTime = (minute: number | null | undefined) => {
  if (minute === null || minute === undefined) return ''
  const date = new Date(2000, 0, 1, Math.floor(minute / 60) % 24, minute % 60)
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

const priceFormatter = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  maximumFractionDigits: 0,
  style: 'currency',
})

const groupByCategory = (products: PublicProduct[]) => {
  const groups = new Map<ProductCategory, PublicProduct[]>()
  for (const product of products) {
    const existing = groups.get(product.category) ?? []
    existing.push(product)
    groups.set(product.category, existing)
  }
  // Keep the Repairs / Plans / Add-ons order the Next.js page rendered.
  return PRODUCT_CATEGORIES.filter((category) => groups.has(category)).map(
    (category) => ({
      category,
      items: groups.get(category) ?? [],
    })
  )
}

// Minimal public top bar — the storefront renders outside the dashboard shell.
function PublicNav() {
  return (
    <nav className="public-nav">
      <Link className="public-nav__brand" to="/">
        <span className="brand-mark">
          <StoreIcon size={18} />
        </span>
        ServiceDock
      </Link>
      <Link className="btn btn--secondary btn--sm" to="/sign-up">
        Create your own
      </Link>
    </nav>
  )
}

function PublicFooter() {
  return (
    <footer className="public-footer">
      Powered by <Link to="/">ServiceDock</Link>
    </footer>
  )
}

function PublicStateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="public-shell">
      <PublicNav />
      <div className="public-state">{children}</div>
      <PublicFooter />
    </div>
  )
}

export function PublicStore() {
  const { city, idOrSlug } = useParams<{ city: string; idOrSlug: string }>()
  const [store, setStore] = useState<PublicStoreData | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<'All' | ProductCategory>('All')

  useEffect(() => {
    if (!(city && idOrSlug)) {
      return
    }
    setLoading(true)
    setNotFound(false)
    setError(null)
    const loadStore = () => api
      .get<{ store: PublicStoreData }>(`/public/stores/${city}/${idOrSlug}`)
      .then((res) => setStore(res.store))
      .catch((err) => {
        if (
          typeof err === 'object' &&
          err !== null &&
          'status' in err &&
          (err as { status: number }).status === 404
        ) {
          setNotFound(true)
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load store')
      })
      .finally(() => setLoading(false))
    loadStore()
    const interval = window.setInterval(loadStore, 60_000)
    return () => window.clearInterval(interval)
  }, [city, idOrSlug])

  const handleDownload = async () => {
    if (!store) {
      return
    }
    setPdfLoading(true)
    setPdfError(null)
    try {
      // Lazy-loaded so jsPDF stays out of the initial bundle.
      const { downloadCatalogPdf } = await import('../lib/catalog-pdf')
      await downloadCatalogPdf(store, store.products, window.location.href)
    } catch (err) {
      setPdfError(
        err instanceof Error ? err.message : 'Could not generate the PDF.'
      )
    } finally {
      setPdfLoading(false)
    }
  }

  if (loading) {
    return (
      <PublicStateShell>
        <div className="stack">
          <Spinner />
          <p className="muted">Loading store…</p>
        </div>
      </PublicStateShell>
    )
  }

  if (notFound) {
    return (
      <PublicStateShell>
        <EmptyState
          icon={<StoreIcon size={30} />}
          title="Store not found"
        >
          The service location you are looking for does not exist.
        </EmptyState>
      </PublicStateShell>
    )
  }

  if (error || !store) {
    return (
      <PublicStateShell>
        <Alert tone="error">{error ?? 'Failed to load store'}</Alert>
      </PublicStateShell>
    )
  }

  const grouped = groupByCategory(store.products)
  const visibleProducts = activeCategory === 'All'
    ? store.products
    : store.products.filter((product) => product.category === activeCategory)
  // Ported reserve-button intent: a WhatsApp/contact affordance for the phone.
  const digitsOnly = store.phone.replace(/\D/g, '')

  return (
    <div className="public-shell">
      <PublicNav />
      <main className="public-container">
        <section className="public-hero">
          <div
            className="public-hero__banner"
            style={
              store.bannerUrl
                ? { backgroundImage: `url(${store.bannerUrl})` }
                : undefined
            }
          >
            <div className="public-hero__overlay" />
          </div>
          <div className="public-hero__body">
            {store.logoUrl ? (
              <img
                alt={`${store.name} logo`}
                className="public-hero__logo"
                src={store.logoUrl}
              />
            ) : (
              <div className="public-hero__logo public-hero__logo--fallback">
                <StoreIcon size={40} />
              </div>
            )}

            <h1 className="public-hero__title">{store.name}</h1>

            <div className="public-meta">
              <span className="row">
                <MapPinIcon size={16} />
                {store.address}, {store.cityName}
              </span>
              {store.phone ? (
                <a className="row" href={`tel:${digitsOnly}`}>
                  <PhoneIcon size={16} />
                  {store.phone}
                </a>
              ) : null}
            </div>

            {store.description ? (
              <p className="public-hero__desc muted">{store.description}</p>
            ) : null}

            <div className="public-hero__actions">
              {digitsOnly ? (
                <a
                  className="btn btn--primary"
                  href={`https://wa.me/${digitsOnly}`}
                  rel="noopener"
                  target="_blank"
                >
                  <PhoneIcon size={16} />
                  Reserve / Contact
                </a>
              ) : null}
              <Button
                loading={pdfLoading}
                onClick={handleDownload}
                variant="secondary"
              >
                <DownloadIcon size={16} />
                Download catalog (PDF)
              </Button>
            </div>

            {pdfError ? (
              <div className="public-hero__error">
                <Alert tone="error">{pdfError}</Alert>
              </div>
            ) : null}
          </div>
        </section>

        {store.availability.enabled && (
          <section className={`public-availability public-availability--${store.availability.status.toLowerCase()}`}>
            <div className="public-availability__status"><span className="public-availability__dot" /><div><small>Live availability</small><h2>{store.availability.status === 'AVAILABLE' ? 'Available right now' : store.availability.status === 'FULL' ? 'Currently full' : 'Closed right now'}</h2><p>{store.availability.schedule?.note || (store.availability.schedule?.isClosed ? 'Closed today' : `Today · ${formatTime(store.availability.schedule?.openMinute)}–${formatTime(store.availability.schedule?.closeMinute)}`)}</p></div></div>
            {store.availability.status !== 'CLOSED' && store.availability.resources.length > 0 && <div className="public-capacity-list">{store.availability.resources.map((item) => <div key={item.id}><strong>{item.availableNow}</strong><span>{item.availableNow === 1 ? item.singularLabel : item.name.toLowerCase()} available</span><small>of {item.totalCapacity}</small></div>)}</div>}
            <span className="public-availability__updated">{store.availability.lastUpdated ? `Updated ${new Date(store.availability.lastUpdated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Hours update automatically'}</span>
          </section>
        )}

        <section className="catalog catalog-showcase">
          {grouped.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SparklesIcon size={30} />}
                title="No services listed yet"
              >
                This store hasn&apos;t published any services. Check back soon.
              </EmptyState>
            </Card>
          ) : (
            <>
              <div className="catalog-intro">
                <div>
                  <span className="catalog-kicker">Service catalog</span>
                  <h2>Find exactly what you need.</h2>
                  <p>Browse our full offering or narrow it down by category.</p>
                </div>
                <div className="catalog-total"><strong>{store.products.length.toString().padStart(2, '0')}</strong><span>services available</span></div>
              </div>

              <div aria-label="Filter services by category" className="catalog-filters" role="tablist">
                <button aria-selected={activeCategory === 'All'} className={activeCategory === 'All' ? 'active' : ''} onClick={() => setActiveCategory('All')} role="tab" type="button">All <span>{store.products.length}</span></button>
                {grouped.map(({ category, items }) => (
                  <button aria-selected={activeCategory === category} className={activeCategory === category ? 'active' : ''} key={category} onClick={() => setActiveCategory(category)} role="tab" type="button">{CATEGORY_LABELS[category]} <span>{items.length}</span></button>
                ))}
              </div>

              <div className="catalog-grid" role="tabpanel">
                {visibleProducts.map((product, index) => (
                  <article className={`catalog-card catalog-card--${product.category.toLowerCase()}`} key={product.id}>
                    <div className="catalog-card__top">
                      <span className="catalog-card__index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="catalog-card__category">{CATEGORY_LABELS[product.category]}</span>
                    </div>
                    <div className="catalog-card__body">
                      <h3>{product.name}</h3>
                      <p>{product.description || 'Ask our team for details about this service.'}</p>
                    </div>
                    <div className="catalog-card__footer">
                      <div><small>Starting at</small><strong>{priceFormatter.format(product.price)}</strong></div>
                      {digitsOnly ? <a aria-label={`Ask about ${product.name}`} href={`https://wa.me/${digitsOnly}?text=${encodeURIComponent(`Hi, I'd like to know more about ${product.name}.`)}`} rel="noopener" target="_blank">Ask <span aria-hidden="true">↗</span></a> : null}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
      <PublicFooter />
    </div>
  )
}
