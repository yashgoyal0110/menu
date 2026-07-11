import { type FormEvent, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  ArrowLeftIcon,
  CheckIcon,
  EditIcon,
  MapPinIcon,
  PlusIcon,
  QrIcon,
  SparklesIcon,
  StoreIcon,
  TrashIcon,
  XIcon,
} from '../components/icons'
import { ImportMenuDialog } from '../components/ImportMenuDialog'
import { StoreQr } from '../components/StoreQr'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  PageHead,
  Select,
  Spinner,
} from '../components/ui'
import { UploadImage } from '../components/UploadImage'
import { api } from '../lib/api'

const PRODUCT_CATEGORIES = ['Repairs', 'Plans', 'AddOns'] as const
type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]

type Store = {
  id: string
  name: string
  address: string
  cityName: string
  citySlug: string
  slug: string | null
  province: string
  phone: string
  logo?: { url: string } | null
  banner?: { url: string } | null
}

type Product = {
  id: string
  name: string
  price: number
  category: ProductCategory
  description: string
}

type WorkspaceTab = 'overview' | 'brand' | 'services' | 'publish'

const EMPTY_FORM = {
  name: '',
  price: '',
  category: 'Repairs' as ProductCategory,
  description: '',
}

const CATEGORY_TONE: Record<ProductCategory, 'brand' | 'success' | 'warning'> = {
  Repairs: 'brand',
  Plans: 'success',
  AddOns: 'warning',
}

export function StoreDetail() {
  const { id } = useParams<{ id: string }>()
  const [store, setStore] = useState<Store | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('overview')
  const [showAddService, setShowAddService] = useState(false)

  const loadProducts = () => {
    if (!id) {
      return
    }
    api
      .get<{ products: Product[] }>(`/products?storeId=${id}`)
      .then((res) => setProducts(res.products))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load services'))
  }

  useEffect(() => {
    if (!id) {
      return
    }
    setLoading(true)
    Promise.all([
      api.get<{ store: Store }>(`/stores/${id}`),
      api.get<{ products: Product[] }>(`/products?storeId=${id}`),
    ])
      .then(([storeRes, productsRes]) => {
        setStore(storeRes.store)
        setProducts(productsRes.products)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load location'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!showAddService) {
      return
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowAddService(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [showAddService])

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      await api.post('/products', {
        ...form,
        price: Number(form.price),
        storeId: id,
      })
      setForm(EMPTY_FORM)
      setShowAddService(false)
      loadProducts()
    } catch (err) {
      // Surfaces the plan-limit message from the server (403 PLAN_LIMIT).
      setError(err instanceof Error ? err.message : 'Failed to create service')
    }
  }

  const startEdit = (product: Product) => {
    setEditingId(product.id)
    setEditForm({
      name: product.name,
      price: String(product.price),
      category: product.category,
      description: product.description,
    })
  }

  const onUpdate = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!editingId) {
      return
    }
    setError(null)
    try {
      await api.patch(`/products/${editingId}`, {
        ...editForm,
        price: Number(editForm.price),
      })
      setEditingId(null)
      loadProducts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update service')
    }
  }

  const onDelete = async (productId: string) => {
    setError(null)
    try {
      await api.del(`/products/${productId}`)
      loadProducts()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete service')
    }
  }

  if (loading) {
    return (
      <div className="row" style={{ justifyContent: 'center', padding: '2rem' }}>
        <Spinner />
      </div>
    )
  }

  const publicUrl = store
    ? `${window.location.origin}/stores/${store.citySlug}/${store.slug ?? store.id}`
    : ''
  const brandReady = Boolean(store?.logo && store?.banner)
  const servicesReady = products.length > 0
  const completedSteps = 1 + Number(brandReady) + Number(servicesReady)
  const progress = Math.round((completedSteps / 3) * 100)

  const tabs: Array<{
    id: WorkspaceTab
    label: string
    description: string
    complete: boolean
  }> = [
    { id: 'overview', label: 'Overview', description: 'Your progress', complete: true },
    { id: 'brand', label: 'Brand', description: 'Logo & banner', complete: brandReady },
    { id: 'services', label: 'Services', description: `${products.length} listed`, complete: servicesReady },
    { id: 'publish', label: 'Publish', description: 'Share & QR', complete: brandReady && servicesReady },
  ]

  return (
    <div className="location-workspace-page">
      <Link
        className="workspace-back row text-sm muted"
        to="/dashboard/stores"
      >
        <ArrowLeftIcon size={16} />
        Back to locations
      </Link>

      <PageHead
        actions={<Badge tone={brandReady && servicesReady ? 'success' : 'warning'}>{brandReady && servicesReady ? 'Ready to share' : `${progress}% setup`}</Badge>}
        subtitle={
          store
            ? `${store.address}, ${store.cityName}, ${store.province} · ${store.phone}`
            : undefined
        }
        title={store ? store.name : 'Location'}
      />

      <div className="stack">
        {error && <Alert tone="error">{error}</Alert>}

        {store && (
          <Card className="workspace-card">
            <div className="workspace-progress">
              <div className="row-between">
                <div>
                  <span className="page-kicker">Storefront setup</span>
                  <strong>{completedSteps} of 3 essentials complete</strong>
                </div>
                <span>{progress}%</span>
              </div>
              <div className="workspace-progress__track"><span style={{ width: `${progress}%` }} /></div>
            </div>

            <div aria-label="Location setup phases" className="workspace-tabs" role="tablist">
              {tabs.map((tab, index) => (
                <button
                  aria-controls={`panel-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  className={`workspace-tab ${activeTab === tab.id ? 'active' : ''}`}
                  id={`tab-${tab.id}`}
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  <span className={`workspace-tab__number ${tab.complete ? 'complete' : ''}`}>{tab.complete ? <CheckIcon size={14} /> : index + 1}</span>
                  <span><strong>{tab.label}</strong><small>{tab.description}</small></span>
                </button>
              ))}
            </div>

            <div aria-labelledby={`tab-${activeTab}`} className="workspace-panel" id={`panel-${activeTab}`} role="tabpanel">
              {activeTab === 'overview' && (
                <div className="overview-panel">
                  <section className="storefront-snapshot">
                    <div className="storefront-snapshot__cover" style={store.banner?.url ? { backgroundImage: `linear-gradient(180deg, transparent, rgba(12,23,18,.7)), url(${store.banner.url})` } : undefined}>
                      {store.logo?.url ? <img alt={`${store.name} logo`} src={store.logo.url} /> : <span><StoreIcon size={28} /></span>}
                      <div><small>Your customer storefront</small><strong>{store.name}</strong></div>
                    </div>
                    <div className="storefront-snapshot__meta">
                      <span><MapPinIcon size={16} /> {store.address}, {store.cityName}</span>
                      <span><StoreIcon size={16} /> {products.length} services published</span>
                    </div>
                  </section>

                  <section className="setup-checklist">
                    <span className="page-kicker">Recommended next steps</span>
                    <h2>Build your storefront in a few focused steps.</h2>
                    <button className="setup-task" onClick={() => setActiveTab('brand')} type="button">
                      <span className={brandReady ? 'done' : ''}>{brandReady ? <CheckIcon size={16} /> : '1'}</span>
                      <div><strong>Add your visual identity</strong><small>Upload a logo and an inviting cover image.</small></div><b>→</b>
                    </button>
                    <button className="setup-task" onClick={() => setActiveTab('services')} type="button">
                      <span className={servicesReady ? 'done' : ''}>{servicesReady ? <CheckIcon size={16} /> : '2'}</span>
                      <div><strong>Build your service catalog</strong><small>Add services manually or import an existing menu.</small></div><b>→</b>
                    </button>
                    <button className="setup-task" onClick={() => setActiveTab('publish')} type="button">
                      <span>3</span><div><strong>Share with customers</strong><small>Copy your public link or download its QR code.</small></div><b>→</b>
                    </button>
                  </section>
                </div>
              )}

              {activeTab === 'brand' && (
                <div className="phase-panel">
                  <div className="phase-panel__head"><div><span className="page-kicker">Phase 1</span><h2>Make it unmistakably yours</h2><p className="muted">Strong visual cues help customers recognize and trust your business.</p></div><Badge tone={brandReady ? 'success' : 'warning'}>{brandReady ? 'Complete' : '2 assets needed'}</Badge></div>
                  <div className="brand-upload-grid">
                    <UploadImage currentUrl={store.logo?.url} kind="logo" onUploaded={(url) => setStore((s) => (s ? { ...s, logo: { url } } : s))} storeId={store.id} />
                    <UploadImage currentUrl={store.banner?.url} kind="banner" onUploaded={(url) => setStore((s) => (s ? { ...s, banner: { url } } : s))} storeId={store.id} />
                  </div>
                  <div className="phase-footer"><Button onClick={() => setActiveTab('overview')} variant="ghost">Back</Button><Button onClick={() => setActiveTab('services')}>Continue to services <span aria-hidden="true">→</span></Button></div>
                </div>
              )}

              {activeTab === 'services' && (
                <div className="phase-panel">
                  <div className="phase-panel__head service-phase-head"><div><span className="page-kicker">Phase 2</span><h2>Shape your service catalog</h2><p className="muted">Keep your offering current, clear, and easy for customers to scan.</p></div><Button onClick={() => setShowAddService(true)}><PlusIcon size={16} /> Add service</Button></div>

                  <section className="ai-import-spotlight">
                    <div className="ai-import-spotlight__copy">
                      <span className="ai-orb"><SparklesIcon size={24} /></span>
                      <div><span className="page-kicker">Fastest way to start</span><h3>Already have a menu? Let AI build the catalog.</h3><p>Upload a PDF, image, or service sheet and we’ll extract the names, descriptions, categories, and prices for you.</p></div>
                    </div>
                    <div className="ai-import-spotlight__action"><ImportMenuDialog onImported={loadProducts} storeId={store.id} /></div>
                  </section>

                  <div className="catalog-toolbar">
                    <div><span className="page-kicker">Your catalog</span><h3>Published services</h3><p className="muted text-sm">Everything customers can currently see on this storefront.</p></div>
                    <div className="catalog-count"><strong>{products.length.toString().padStart(2, '0')}</strong><span>services</span></div>
                  </div>

                  <div className="service-catalog-card">
                      {products.length === 0 ? <EmptyState title="Start with your first service">Use the form or import your current service sheet.</EmptyState> : (
                        <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Description</th><th style={{ width: 92 }}>Actions</th></tr></thead><tbody>
                          {products.map((p) => editingId === p.id ? (
                            <tr key={p.id}><td><Input aria-label="Name" onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} required value={editForm.name} /></td><td><Select aria-label="Category" onChange={(e) => setEditForm({ ...editForm, category: e.target.value as ProductCategory })} value={editForm.category}>{PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></td><td><Input aria-label="Price" onChange={(e) => setEditForm({ ...editForm, price: e.target.value })} required type="number" value={editForm.price} /></td><td><Input aria-label="Description" onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} required value={editForm.description} /></td><td><div className="row"><IconButton label="Save" onClick={() => onUpdate()}><CheckIcon size={16} /></IconButton><IconButton label="Cancel" onClick={() => setEditingId(null)}><XIcon size={16} /></IconButton></div></td></tr>
                          ) : (
                            <tr key={p.id}><td><strong>{p.name}</strong></td><td><Badge tone={CATEGORY_TONE[p.category]}>{p.category}</Badge></td><td>{p.price}</td><td className="muted">{p.description}</td><td><div className="row"><IconButton label="Edit service" onClick={() => startEdit(p)}><EditIcon size={16} /></IconButton><IconButton danger label="Delete service" onClick={() => onDelete(p.id)}><TrashIcon size={16} /></IconButton></div></td></tr>
                          ))}
                        </tbody></table></div>
                      )}
                  </div>
                  <div className="phase-footer"><Button onClick={() => setActiveTab('brand')} variant="ghost">Back</Button><Button disabled={!servicesReady} onClick={() => setActiveTab('publish')}>Continue to publish <span aria-hidden="true">→</span></Button></div>
                </div>
              )}

              {activeTab === 'publish' && (
                <div className="phase-panel publish-panel">
                  <div className="phase-panel__head"><div><span className="page-kicker">Phase 3</span><h2>Put your storefront in customers’ hands</h2><p className="muted">Your link is live. Share it online or place the QR code at your counter.</p></div><span className="publish-live"><i /> Live</span></div>
                  <div className="publish-layout"><div className="publish-copy"><QrIcon size={28} /><h3>One scan. Your whole catalog.</h3><p className="muted">Download the code for signage, receipts, business cards, or your front window.</p><div className="publish-tip"><SparklesIcon size={18} /><span><strong>Tip</strong> Test the link on your phone before printing it at scale.</span></div></div><div className="qr-card"><StoreQr url={publicUrl} /></div></div>
                  <div className="phase-footer"><Button onClick={() => setActiveTab('services')} variant="ghost">Back</Button><a className="btn btn--primary" href={publicUrl} rel="noreferrer" target="_blank">Open public page <span aria-hidden="true">↗</span></a></div>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      {showAddService && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAddService(false) }} role="presentation">
          <section aria-labelledby="add-service-title" aria-modal="true" className="service-modal" role="dialog">
            <div className="service-modal__head">
              <div><span className="page-kicker">New catalog item</span><h2 id="add-service-title">Add a service</h2><p className="muted">Give customers just enough detail to make a confident choice.</p></div>
              <button aria-label="Close add service dialog" className="location-form-close" onClick={() => setShowAddService(false)} type="button">×</button>
            </div>
            <form className="service-modal__form" onSubmit={onCreate}>
              <Field htmlFor="service-name" label="Service name"><Input autoFocus id="service-name" onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Premium brake inspection" required value={form.name} /></Field>
              <div className="form-grid"><Field htmlFor="service-price" label="Price"><Input id="service-price" min="0" onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" required type="number" value={form.price} /></Field><Field htmlFor="service-category" label="Category"><Select id="service-category" onChange={(e) => setForm({ ...form, category: e.target.value as ProductCategory })} value={form.category}>{PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field></div>
              <Field hint="Keep it clear and benefit-focused." htmlFor="service-description" label="Customer-facing description"><Input id="service-description" onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What is included and why customers choose it" required value={form.description} /></Field>
              <div className="service-modal__preview"><span>Customer preview</span><div><strong>{form.name || 'Your service name'}</strong><p>{form.description || 'A concise description will appear here.'}</p></div><b>{form.price ? `$${form.price}` : '$0.00'}</b></div>
              <div className="service-modal__footer"><Button onClick={() => setShowAddService(false)} type="button" variant="ghost">Cancel</Button><Button type="submit"><PlusIcon size={16} /> Publish service</Button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
