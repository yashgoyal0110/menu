import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'

import { env } from './env.js'
import { errorHandler } from './middleware/error.js'
import authRouter from './routes/auth.js'
import billingRouter, { stripeWebhookHandler } from './routes/billing.js'
import importRouter from './routes/import.js'
import mapboxRouter from './routes/mapbox.js'
import productsRouter from './routes/products.js'
import publicRouter from './routes/public.js'
import storesRouter from './routes/stores.js'
import uploadsRouter from './routes/uploads.js'

const app = express()

// Stripe webhook must see the RAW request body for signature verification, so
// it is registered BEFORE express.json() parses bodies.
app.post(
  '/api/billing/webhook',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler,
)

app.use(express.json())
app.use(cookieParser())
app.use(
  cors({
    origin: env.NODE_ENV === 'production' ? true : 'http://localhost:5173',
    credentials: true,
  }),
)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/api/auth', authRouter)
app.use('/api/stores', storesRouter)
app.use('/api/products', productsRouter)
app.use('/api/mapbox', mapboxRouter)
app.use('/api/billing', billingRouter)
app.use('/api/public', publicRouter)
// uploads + import routers declare their own /stores/:id/... sub-paths.
app.use('/api', uploadsRouter)
app.use('/api', importRouter)

// Serve the built React client (single-container deploy). The Dockerfile
// copies the Vite build output to ../client/dist relative to the compiled
// server entry (dist/index.js), i.e. <app>/client/dist.
const here = dirname(fileURLToPath(import.meta.url))
const clientDist = join(here, '..', '..', 'client', 'dist')

if (existsSync(clientDist)) {
  app.use(express.static(clientDist))
  // SPA fallback: any non-API GET returns index.html so client-side routing works.
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'))
  })
}

app.use(errorHandler)

app.listen(env.PORT, () => {
  console.log(`Server listening on http://0.0.0.0:${env.PORT}`)
})
