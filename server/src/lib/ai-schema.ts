import { z } from 'zod'

import { PRODUCT_CATEGORIES } from '../config/products.js'

/**
 * Zod schema for the AI service-catalog extraction. Ported from the Next.js
 * app's src/lib/validations/product.ts (aiExtractedProductSchema +
 * aiMenuExtractionSchema). The `.describe()` calls are passed through to the
 * model as JSON-schema descriptions and materially guide the extraction.
 */
const aiExtractedProductSchema = z.object({
  name: z.string().describe('Service name from the catalog'),
  price: z
    .number()
    .describe('Service price as a number without currency symbols'),
  description: z
    .string()
    .describe(
      "Customer-facing service description in English. Don't exceed 120 characters.",
    ),
  category: z
    .enum(PRODUCT_CATEGORIES)
    .describe('Service category: Repairs, Plans, or AddOns'),
})

export const aiMenuExtractionSchema = z.object({
  products: z
    .array(aiExtractedProductSchema)
    .describe('Array of all service catalog items found in the image or PDF'),
})

export type AiExtractedProduct = z.infer<typeof aiExtractedProductSchema>
