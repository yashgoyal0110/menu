import { google } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { Router } from 'express'
import multer, { MulterError } from 'multer'

import { aiMenuExtractionSchema } from '../lib/ai-schema.js'
import { ensureCanCreateProducts, PlanLimitError } from '../lib/limits.js'
import type { AuthedRequest } from '../middleware/auth.js'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../prisma.js'

/**
 * AI service-catalog import. Ported from the Next.js app's
 * src/lib/actions/import-menu.ts: an uploaded image/PDF is sent to Gemini via
 * the Vercel AI SDK, which extracts a list of services that are then
 * bulk-created for the store.
 */

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // ~10MB

// Match the model + system prompt from the original Next.js action.
const GEMINI_MODEL = 'gemini-3.5-flash'
const SYSTEM_PROMPT =
  'You are a helpful assistant that extracts service catalog items from images/PDFs.' +
  'Return concise customer-facing service names and descriptions.'
const EXTRACTION_INSTRUCTION =
  'Extract all service catalog items from this image/PDF. For each item, provide the name, price as a number without currency symbols, description, and category. Use Repairs for repairs/core services, Plans for plans/subscriptions, and AddOns for add-ons. If you cannot determine the category clearly, use Repairs as default.'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype.startsWith('image/') ||
      file.mimetype === 'application/pdf'
    ) {
      cb(null, true)
      return
    }
    cb(new Error('Only image files or PDFs are allowed.'))
  },
})

const router = Router()

router.use(requireAuth)

/**
 * Wraps multer's single-file middleware so upload errors (oversized file,
 * disallowed mimetype) surface as 400s instead of the generic 500 handler.
 */
const uploadSingle = upload.single('file')
function handleUpload(
  req: AuthedRequest,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  uploadSingle(req, res, (err: unknown) => {
    if (err instanceof MulterError || err instanceof Error) {
      res.status(400).json({ error: err.message })
      return
    }
    next()
  })
}

/**
 * The @ai-sdk/google provider reads GOOGLE_GENERATIVE_AI_API_KEY, but the
 * Next.js app configured GEMINI_API_KEY. Bridge the two so either works.
 * Returns false when neither key is configured.
 */
function ensureGoogleApiKey(): boolean {
  if (
    !process.env.GOOGLE_GENERATIVE_AI_API_KEY &&
    process.env.GEMINI_API_KEY
  ) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY
  }
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY)
}

router.post(
  '/stores/:id/import',
  handleUpload,
  async (req: AuthedRequest, res, next) => {
    try {
      const userId = req.auth?.userId
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const file = req.file
      if (!file) {
        res.status(400).json({ error: 'File is required' })
        return
      }

      if (!ensureGoogleApiKey()) {
        res.status(503).json({
          error:
            'GEMINI_API_KEY (or GOOGLE_GENERATIVE_AI_API_KEY) is required to import a catalog with AI.',
        })
        return
      }

      // Verify store ownership.
      const store = await db.store.findFirst({
        where: { id: req.params.id, userId },
      })
      if (!store) {
        res.status(404).json({ error: 'Location not found.' })
        return
      }

      // Pass the uploaded file straight to the model as a content part. PDFs use
      // a `file` part; images use an `image` part (AI SDK v5 shapes).
      const filePart =
        file.mimetype === 'application/pdf'
          ? ({
              type: 'file' as const,
              data: file.buffer,
              mediaType: file.mimetype,
            } as const)
          : ({
              type: 'image' as const,
              image: file.buffer,
              mediaType: file.mimetype,
            } as const)

      const result = await generateObject({
        model: google(GEMINI_MODEL),
        system: SYSTEM_PROMPT,
        schema: aiMenuExtractionSchema,
        schemaName: 'service_catalog',
        schemaDescription: 'Service catalog items extracted from the image/PDF',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: EXTRACTION_INSTRUCTION }, filePart],
          },
        ],
      })

      const { products } = result.object

      if (!products || products.length === 0) {
        res.status(422).json({ error: 'No services were found in the file' })
        return
      }

      // Enforce the plan's per-store service limit before writing.
      await ensureCanCreateProducts(userId, store.id, products.length)

      const created = await db.product.createMany({
        data: products.map((product) => ({
          name: product.name,
          price: Math.round(product.price), // Prisma Product.price is Int.
          description: product.description,
          category: product.category,
          storeId: store.id,
        })),
        skipDuplicates: true,
      })

      res.json({ created: created.count, products })
    } catch (err) {
      if (err instanceof PlanLimitError) {
        res.status(403).json({ error: err.message, code: err.code })
        return
      }
      next(err)
    }
  },
)

export default router
