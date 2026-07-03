import { Storage } from '@google-cloud/storage'

/**
 * Google Cloud Storage for user image uploads (store logos/banners).
 * Auth uses Application Default Credentials — set GOOGLE_APPLICATION_CREDENTIALS
 * to the service-account JSON path (and GCS_BUCKET / GCS_PROJECT_ID).
 * When GCS_BUCKET is unset, uploads report "not configured".
 */

const BUCKET_NAME = process.env.GCS_BUCKET

export const gcsEnabled = Boolean(BUCKET_NAME)

const storage = new Storage({ projectId: process.env.GCS_PROJECT_ID })
const bucket = BUCKET_NAME ? storage.bucket(BUCKET_NAME) : null

/** Public URL for an object (works when the bucket allows public reads). */
export function objectUrl(key: string): string {
  return `https://storage.googleapis.com/${BUCKET_NAME}/${key}`
}

/**
 * Uploads a buffer and returns its public URL. Throws if GCS isn't configured
 * or the upload fails (so callers can treat it as an all-or-nothing step).
 */
export async function uploadObject(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  if (!bucket) {
    throw new Error('Image storage (GCS) is not configured.')
  }
  const file = bucket.file(key)
  // Use an explicit write stream and end it once with the buffer. This avoids
  // file.save()'s buffer-retry path, which — when the underlying HTTP request
  // errors (403/404/401) — re-drives a destroyed stream and masks the real
  // failure as "Cannot call write after a stream was destroyed".
  await new Promise<void>((resolve, reject) => {
    const stream = file.createWriteStream({
      contentType,
      resumable: false,
      metadata: { cacheControl: 'public, max-age=86400' },
    })
    stream.on('error', reject)
    stream.on('finish', resolve)
    stream.end(buffer)
  })
  // Best-effort: buckets with uniform bucket-level access reject per-object
  // ACLs — in that case public access must be granted at the bucket IAM level.
  try {
    await file.makePublic()
  } catch {
    // Ignore; rely on bucket-level public access if configured.
  }
  return objectUrl(key)
}

/** Best-effort object deletion; a missing object never throws. */
export async function deleteObject(key: string): Promise<void> {
  if (!bucket) {
    return
  }
  try {
    await bucket.file(key).delete({ ignoreNotFound: true })
  } catch {
    // Ignore — object already gone or transient error on cleanup.
  }
}
