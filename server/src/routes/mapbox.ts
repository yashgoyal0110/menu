import { Router } from 'express'
import { z } from 'zod'

import type { AuthedRequest } from '../middleware/auth.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.use(requireAuth)

/**
 * Server-side proxy for the Mapbox Search Box API so the access token never
 * reaches the browser. Ported from the Next.js app's src/lib/mapbox.ts +
 * src/lib/location.ts (suggest/retrieve flow and field mapping).
 */

// --- slugify helper, ported verbatim from src/lib/location.ts ---
const DIACRITICS_REGEX = /[\u0300-\u036f]/g
const NON_SLUG_CHARS_REGEX = /[^a-z0-9]+/g
const SLUG_EDGE_DASH_REGEX = /^-+|-+$/g

function slugifyCityName(cityName: string): string {
  return cityName
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .toLowerCase()
    .trim()
    .replace(NON_SLUG_CHARS_REGEX, '-')
    .replace(SLUG_EDGE_DASH_REGEX, '')
}

function getAccessToken(): string | undefined {
  return (
    process.env.MAPBOX_TOKEN ??
    process.env.MAPBOX_SECRET_TOKEN ??
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  )
}

const SEARCHBOX_BASE = 'https://api.mapbox.com/search/searchbox/v1'

type MapboxContext = {
  country?: { name?: string }
  region?: { name?: string }
  district?: { name?: string }
  place?: { name?: string }
  locality?: { name?: string }
  neighborhood?: { name?: string }
}

type MapboxFeature = {
  geometry?: {
    coordinates?: [number, number]
  }
  properties?: {
    name?: string
    full_address?: string
    place_formatted?: string
    context?: MapboxContext
    metadata?: { phone?: string }
  }
}

type MapboxRetrieveResponse = {
  features?: MapboxFeature[]
}

const suggestQuerySchema = z.object({
  q: z.string().min(1),
  sessionToken: z.string().min(1),
})

const retrieveQuerySchema = z.object({
  id: z.string().min(1),
  sessionToken: z.string().min(1),
})

router.get('/suggest', async (req: AuthedRequest, res, next) => {
  try {
    const accessToken = getAccessToken()
    if (!accessToken) {
      res.status(503).json({
        error:
          'Mapbox is not configured. Set MAPBOX_TOKEN on the server to enable address search.',
      })
      return
    }

    const { q, sessionToken } = suggestQuerySchema.parse(req.query)

    const url = new URL(`${SEARCHBOX_BASE}/suggest`)
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('q', q)
    url.searchParams.set('session_token', sessionToken)
    url.searchParams.set('language', 'en')
    url.searchParams.set('limit', '5')
    url.searchParams.set('types', 'address,poi')

    const response = await fetch(url)
    if (!response.ok) {
      res.status(502).json({ error: 'Address search is unavailable.' })
      return
    }

    const data = (await response.json()) as {
      suggestions?: Array<{
        name?: string
        mapbox_id?: string
        place_formatted?: string
      }>
    }

    const suggestions = (data.suggestions ?? []).map((s) => ({
      name: s.name ?? '',
      mapbox_id: s.mapbox_id ?? '',
      place_formatted: s.place_formatted ?? '',
    }))

    res.json({ suggestions })
  } catch (err) {
    next(err)
  }
})

router.get('/retrieve', async (req: AuthedRequest, res, next) => {
  try {
    const accessToken = getAccessToken()
    if (!accessToken) {
      res.status(503).json({
        error:
          'Mapbox is not configured. Set MAPBOX_TOKEN on the server to enable address search.',
      })
      return
    }

    const { id, sessionToken } = retrieveQuerySchema.parse(req.query)

    const url = new URL(
      `${SEARCHBOX_BASE}/retrieve/${encodeURIComponent(id)}`
    )
    url.searchParams.set('access_token', accessToken)
    url.searchParams.set('session_token', sessionToken)
    url.searchParams.set('language', 'en')

    const response = await fetch(url)
    if (!response.ok) {
      res.status(502).json({ error: 'Could not validate the selected address.' })
      return
    }

    const data = (await response.json()) as MapboxRetrieveResponse
    const feature = data.features?.[0]
    const coordinates = feature?.geometry?.coordinates
    const context = feature?.properties?.context
    const cityName =
      context?.place?.name ??
      context?.locality?.name ??
      context?.district?.name ??
      context?.neighborhood?.name
    // Some countries and city-states do not have a region in Mapbox's
    // response. Keep the required store field useful by falling back to the
    // country rather than rejecting an otherwise complete address.
    const province = context?.region?.name ?? context?.country?.name
    const address =
      feature?.properties?.full_address ??
      [feature?.properties?.name, feature?.properties?.place_formatted]
        .filter(Boolean)
        .join(', ')
    const phone = feature?.properties?.metadata?.phone

    if (!(coordinates && cityName && province && address)) {
      res.status(422).json({ error: 'The selected address is incomplete.' })
      return
    }

    res.json({
      address,
      citySlug: slugifyCityName(cityName),
      cityName,
      province,
      latitude: coordinates[1],
      longitude: coordinates[0],
      ...(phone ? { phone } : {}),
    })
  } catch (err) {
    next(err)
  }
})

export default router
