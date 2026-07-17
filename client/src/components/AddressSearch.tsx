import { useEffect, useId, useRef, useState } from 'react'

import { api } from '../lib/api'
import { MapPinIcon } from './icons'
import { Field, Input, Spinner } from './ui'

/**
 * Fields the retrieve endpoint maps a Mapbox feature into. Mirrors the store
 * form shape (latitude/longitude are strings because the form keeps them as
 * text until submit). Ported from the Next.js Mapbox suggest/retrieve flow.
 */
export type AddressFields = {
  address: string
  citySlug: string
  cityName: string
  province: string
  latitude: string
  longitude: string
  phone?: string
}

type Suggestion = {
  name: string
  mapbox_id: string
  place_formatted: string
}

type SuggestResponse = {
  suggestions: Suggestion[]
}

type RetrieveResponse = {
  address: string
  citySlug: string
  cityName: string
  province: string
  latitude: number
  longitude: number
  phone?: string
}

type AddressSearchProps = {
  onSelect: (fields: AddressFields) => void
}

const MIN_QUERY_LENGTH = 3
const DEBOUNCE_MS = 250

function formatSuggestion(suggestion: Suggestion): string {
  return [suggestion.name, suggestion.place_formatted].filter(Boolean).join(', ')
}

export function AddressSearch({ onSelect }: AddressSearchProps) {
  const inputId = useId()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A single session token is reused across suggest calls and the final
  // retrieve, then rotated after a selection (Mapbox billing session).
  const [sessionToken, setSessionToken] = useState(() => crypto.randomUUID())
  // When true, the current query text is a committed selection, so we suppress
  // the suggest effect until the user edits the input again.
  const selectedRef = useRef(false)

  useEffect(() => {
    if (selectedRef.current || query.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([])
      return
    }

    const timeoutId = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      api
        .get<SuggestResponse>(
          `/mapbox/suggest?q=${encodeURIComponent(query)}&sessionToken=${encodeURIComponent(sessionToken)}`
        )
        .then((data) => setSuggestions(data.suggestions))
        .catch((err) => {
          setSuggestions([])
          setError(err instanceof Error ? err.message : 'Address search failed')
        })
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [query, sessionToken])

  const handleSelect = async (suggestion: Suggestion) => {
    selectedRef.current = true
    setQuery(formatSuggestion(suggestion))
    setSuggestions([])
    setError(null)
    try {
      const feature = await api.get<RetrieveResponse>(
        `/mapbox/retrieve?id=${encodeURIComponent(suggestion.mapbox_id)}&sessionToken=${encodeURIComponent(sessionToken)}`
      )
      onSelect({
        address: feature.address,
        citySlug: feature.citySlug,
        cityName: feature.cityName,
        province: feature.province,
        latitude: String(feature.latitude),
        longitude: String(feature.longitude),
        ...(feature.phone ? { phone: feature.phone } : {}),
      })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not retrieve that address'
      )
    } finally {
      // Rotate the session token so the next search starts a fresh session.
      setSessionToken(crypto.randomUUID())
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <Field
        hint="Search worldwide to auto-fill the address fields below."
        htmlFor={inputId}
        label="Search address"
      >
        <Input
          aria-controls={listId}
          aria-expanded={suggestions.length > 0}
          autoComplete="off"
          id={inputId}
          onChange={(e) => {
            selectedRef.current = false
            setQuery(e.target.value)
          }}
          placeholder="Start typing any business address"
          role="combobox"
          value={query}
        />
      </Field>

      {loading && (
        <span className="row text-sm muted" style={{ marginTop: '0.4rem' }}>
          <Spinner /> Searching address…
        </span>
      )}
      {error && (
        <p className="error" style={{ marginTop: '0.4rem' }}>
          {error}
        </p>
      )}

      {suggestions.length > 0 && (
        <ul
          className="card"
          id={listId}
          role="listbox"
          style={{
            listStyle: 'none',
            margin: '0.4rem 0 0',
            padding: '0.35rem',
            position: 'absolute',
            zIndex: 20,
            width: '100%',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion.mapbox_id} role="option">
              <button
                className="btn btn--ghost"
                onClick={() => handleSelect(suggestion)}
                style={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  gap: '0.5rem',
                  fontWeight: 500,
                }}
                type="button"
              >
                <MapPinIcon size={16} />
                <span>
                  <strong>{suggestion.name}</strong>
                  {suggestion.place_formatted
                    ? ` — ${suggestion.place_formatted}`
                    : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
