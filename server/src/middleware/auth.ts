import type { NextFunction, Request, Response } from 'express'

import { verifyToken } from '../lib/auth.js'

export type AuthedRequest = Request & {
  auth?: { id: string; userId: string }
}

/**
 * Reads the JWT from the httpOnly cookie (or Authorization: Bearer header),
 * verifies it, and attaches { id, userId } to the request. Responds 401 when
 * missing or invalid.
 */
export function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  const cookieToken = (req as Request & { cookies?: Record<string, string> })
    .cookies?.token
  const header = req.headers.authorization
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined
  const token = cookieToken ?? bearer

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const payload = verifyToken(token)
    req.auth = { id: payload.sub, userId: payload.userId }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
