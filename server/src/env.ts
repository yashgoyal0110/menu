import { z } from 'zod'

/**
 * Server environment validation. Mirrors the intent of the old Next.js
 * src/env.ts but for the standalone Express server.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z
    .string()
    .min(16, 'JWT_SECRET is required and must be at least 16 chars'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Plan limits (all env-configurable).
  // Locations allowed on the free Starter plan (default 5).
  FREE_PLAN_STORE_LIMIT: z.coerce.number().int().positive().default(5),
  // Services allowed on the free Starter plan (default 25).
  FREE_PLAN_PRODUCT_LIMIT: z.coerce.number().int().positive().default(25),
  // Locations allowed on the Pro plan (default 10).
  PRO_PLAN_STORE_LIMIT: z.coerce.number().int().positive().default(10),
  // Locations allowed on the Enterprise plan (default 25).
  ENTERPRISE_PLAN_STORE_LIMIT: z.coerce.number().int().positive().default(25),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  // Fail loud on misconfiguration (CLAUDE.md Rule 12).
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors)
  throw new Error('Invalid environment variables')
}

export const env = parsed.data
