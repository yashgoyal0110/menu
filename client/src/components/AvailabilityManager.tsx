import { type FormEvent, useEffect, useState } from 'react'

import { Alert, Badge, Button, Field, Input, Select, Spinner } from './ui'
import { api } from '../lib/api'

type Hour = { dayOfWeek: number; isClosed: boolean; openMinute: number; closeMinute: number }
type Resource = { id: string; name: string; singularLabel: string; totalCapacity: number; availableNow: number }
type Exception = { id: string; date: string; isClosed: boolean; openMinute: number | null; closeMinute: number | null; note: string | null }
type Data = { enabled: boolean; timezone: string; hours: Hour[]; resources: Resource[]; exceptions: Exception[]; snapshot: { status: string } }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DEFAULT_HOURS = DAYS.map((_, dayOfWeek) => ({ dayOfWeek, isClosed: dayOfWeek === 0, openMinute: 540, closeMinute: 1020 }))
const intlWithTimezones = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
const ZONES = intlWithTimezones.supportedValuesOf?.('timeZone') ?? ['UTC', 'America/New_York', 'Europe/London', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Australia/Sydney']
const toTime = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const toMinute = (time: string) => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute }

export function AvailabilityManager({ storeId, onContinue }: { storeId: string; onContinue: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resource, setResource] = useState({ name: '', singularLabel: '', totalCapacity: '1', availableNow: '1' })
  const [exception, setException] = useState({ date: '', isClosed: true, openMinute: '09:00', closeMinute: '17:00', note: '' })

  const load = () => api.get<{ availability: Data }>(`/availability/stores/${storeId}`).then(({ availability }) => {
    setData({ ...availability, hours: availability.hours.length === 7 ? availability.hours : DEFAULT_HOURS })
  }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load availability'))
  useEffect(() => { void load() }, [storeId])

  const saveSettings = async () => {
    if (!data) return
    setSaving(true); setError(null)
    try { await api.put(`/availability/stores/${storeId}`, { enabled: data.enabled, timezone: data.timezone, hours: data.hours }); await load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save hours') }
    finally { setSaving(false) }
  }

  const addResource = async (event: FormEvent) => {
    event.preventDefault(); setError(null)
    try {
      await api.post(`/availability/stores/${storeId}/resources`, { ...resource, totalCapacity: Number(resource.totalCapacity), availableNow: Number(resource.availableNow) })
      setResource({ name: '', singularLabel: '', totalCapacity: '1', availableNow: '1' }); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not add capacity') }
  }

  const changeAvailable = async (item: Resource, amount: number) => {
    const availableNow = Math.max(0, Math.min(item.totalCapacity, item.availableNow + amount))
    await api.patch(`/availability/stores/${storeId}/resources/${item.id}`, { availableNow }); await load()
  }

  const addException = async (event: FormEvent) => {
    event.preventDefault(); setError(null)
    try {
      await api.post(`/availability/stores/${storeId}/exceptions`, {
        date: exception.date, isClosed: exception.isClosed,
        openMinute: exception.isClosed ? null : toMinute(exception.openMinute),
        closeMinute: exception.isClosed ? null : toMinute(exception.closeMinute), note: exception.note || null,
      })
      setException({ date: '', isClosed: true, openMinute: '09:00', closeMinute: '17:00', note: '' }); await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save special date') }
  }

  if (!data) return <div className="row availability-loading"><Spinner /> Loading availability…</div>
  const statusTone = data.snapshot.status === 'AVAILABLE' ? 'success' : data.snapshot.status === 'FULL' ? 'warning' : 'brand'

  return <div className="phase-panel availability-panel">
    <div className="phase-panel__head"><div><span className="page-kicker">Live operations</span><h2>Hours and availability</h2><p className="muted">Tell customers when you are open and what is available right now.</p></div><Badge tone={statusTone}>{data.enabled ? data.snapshot.status.replace('_', ' ') : 'Not published'}</Badge></div>
    {error && <Alert tone="error">{error}</Alert>}

    <section className="availability-section">
      <div className="availability-section__title"><div><h3>Weekly business hours</h3><p>Times are evaluated in the location timezone.</p></div><label className="availability-switch"><input checked={data.enabled} onChange={(e) => setData({ ...data, enabled: e.target.checked })} type="checkbox" /><span>Show live availability publicly</span></label></div>
      <Field htmlFor="availability-timezone" label="Location timezone"><Select id="availability-timezone" onChange={(e) => setData({ ...data, timezone: e.target.value })} value={data.timezone}>{[...new Set([data.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone, ...ZONES])].map((zone) => <option key={zone}>{zone}</option>)}</Select></Field>
      <div className="hours-list">{data.hours.map((hour, index) => <div className="hours-row" key={hour.dayOfWeek}><strong>{DAYS[hour.dayOfWeek]}</strong><label><input checked={!hour.isClosed} onChange={(e) => { const hours = [...data.hours]; hours[index] = { ...hour, isClosed: !e.target.checked }; setData({ ...data, hours }) }} type="checkbox" /> Open</label><Input aria-label={`${DAYS[hour.dayOfWeek]} opening time`} disabled={hour.isClosed} onChange={(e) => { const hours = [...data.hours]; hours[index] = { ...hour, openMinute: toMinute(e.target.value) }; setData({ ...data, hours }) }} type="time" value={toTime(hour.openMinute)} /><span>to</span><Input aria-label={`${DAYS[hour.dayOfWeek]} closing time`} disabled={hour.isClosed} onChange={(e) => { const hours = [...data.hours]; hours[index] = { ...hour, closeMinute: toMinute(e.target.value) }; setData({ ...data, hours }) }} type="time" value={toTime(hour.closeMinute)} /></div>)}</div>
      <Button loading={saving} onClick={saveSettings}>Save hours & publishing</Button>
    </section>

    <section className="availability-section">
      <div className="availability-section__title"><div><h3>Available right now</h3><p>Create any pool your business sells: barbers, tables, rooms, bays, courts, or staff.</p></div></div>
      <div className="capacity-grid">{data.resources.map((item) => <article className="capacity-card" key={item.id}><div><span>{item.name}</span><strong>{item.availableNow}<small> / {item.totalCapacity}</small></strong><p>{item.availableNow === 1 ? item.singularLabel : item.name.toLowerCase()} available</p></div><div className="capacity-stepper"><button disabled={item.availableNow === 0} onClick={() => changeAvailable(item, -1)} type="button">−</button><button disabled={item.availableNow === item.totalCapacity} onClick={() => changeAvailable(item, 1)} type="button">+</button></div><button className="capacity-remove" onClick={async () => { await api.del(`/availability/stores/${storeId}/resources/${item.id}`); await load() }} type="button">Remove</button></article>)}</div>
      <form className="capacity-form" onSubmit={addResource}><Field htmlFor="pool-name" label="Pool name"><Input id="pool-name" onChange={(e) => setResource({ ...resource, name: e.target.value })} placeholder="Tables" required value={resource.name} /></Field><Field htmlFor="pool-unit" label="Singular label"><Input id="pool-unit" onChange={(e) => setResource({ ...resource, singularLabel: e.target.value })} placeholder="table" required value={resource.singularLabel} /></Field><Field htmlFor="pool-total" label="Total"><Input id="pool-total" min="1" onChange={(e) => setResource({ ...resource, totalCapacity: e.target.value })} required type="number" value={resource.totalCapacity} /></Field><Field htmlFor="pool-available" label="Available now"><Input id="pool-available" min="0" onChange={(e) => setResource({ ...resource, availableNow: e.target.value })} required type="number" value={resource.availableNow} /></Field><Button type="submit">Add capacity pool</Button></form>
    </section>

    <section className="availability-section">
      <div className="availability-section__title"><div><h3>Closures and special hours</h3><p>Override the weekly schedule for holidays, events, or maintenance.</p></div></div>
      <form className="exception-form" onSubmit={addException}><Field htmlFor="special-date" label="Date"><Input id="special-date" onChange={(e) => setException({ ...exception, date: e.target.value })} required type="date" value={exception.date} /></Field><label className="availability-switch"><input checked={exception.isClosed} onChange={(e) => setException({ ...exception, isClosed: e.target.checked })} type="checkbox" /><span>Closed all day</span></label>{!exception.isClosed && <><Field htmlFor="special-open" label="Opens"><Input id="special-open" onChange={(e) => setException({ ...exception, openMinute: e.target.value })} type="time" value={exception.openMinute} /></Field><Field htmlFor="special-close" label="Closes"><Input id="special-close" onChange={(e) => setException({ ...exception, closeMinute: e.target.value })} type="time" value={exception.closeMinute} /></Field></>}<Field htmlFor="special-note" label="Customer note"><Input id="special-note" onChange={(e) => setException({ ...exception, note: e.target.value })} placeholder="Public holiday" value={exception.note} /></Field><Button type="submit" variant="secondary">Save special date</Button></form>
      <div className="exception-list">{data.exceptions.map((item) => <div key={item.id}><span><strong>{item.date.slice(0, 10)}</strong> · {item.isClosed ? 'Closed' : `${toTime(item.openMinute ?? 0)}–${toTime(item.closeMinute ?? 0)}`} {item.note ? `· ${item.note}` : ''}</span><button onClick={async () => { await api.del(`/availability/stores/${storeId}/exceptions/${item.id}`); await load() }} type="button">Remove</button></div>)}</div>
    </section>
    <div className="phase-footer"><span className="muted text-sm">Changes to live counts appear on the public page immediately.</span><Button onClick={onContinue}>Continue to publish <span aria-hidden="true">→</span></Button></div>
  </div>
}
