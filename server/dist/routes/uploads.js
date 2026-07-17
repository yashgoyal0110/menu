import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Router } from 'express';
import multer, { MulterError } from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../prisma.js';
import { deleteObject, gcsEnabled, uploadObject } from '../lib/storage.js';
/**
 * Store logo/banner uploads backed by Google Cloud Storage. The image is held
 * in memory (multer), pushed to GCS, then recorded in the DB. The pair is
 * all-or-nothing: if the DB write fails after upload, the GCS object is
 * removed (rollback); replacing an image deletes the previous object only
 * after the new one is committed.
 */
const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024; // ~4MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png']);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (ALLOWED_MIME.has(file.mimetype) && ALLOWED_EXT.has(ext)) {
            cb(null, true);
            return;
        }
        cb(new Error('Only JPG, JPEG, or PNG images are allowed.'));
    },
});
const router = Router();
router.use(requireAuth);
/** Surfaces multer errors (oversized / wrong type) as 400s. */
const uploadSingle = upload.single('file');
function handleUpload(req, res, next) {
    uploadSingle(req, res, (err) => {
        if (err instanceof MulterError || err instanceof Error) {
            res.status(400).json({ error: err.message });
            return;
        }
        next();
    });
}
async function findOwnedStore(storeId, userId) {
    if (!userId) {
        return null;
    }
    return db.store.findFirst({ where: { id: storeId, userId } });
}
/**
 * Uploads to GCS then upserts the DB row. If the DB write fails, the freshly
 * uploaded object is deleted so we never leave an orphan. Returns the record.
 */
async function commitUpload(kind, storeId, file) {
    const key = `stay/${storeId}/${kind}-${randomUUID()}${extname(file.originalname).toLowerCase()}`;
    const url = await uploadObject(key, file.buffer, file.mimetype);
    const data = {
        name: file.originalname,
        key,
        url,
        status: 'SUCCESS',
    };
    try {
        if (kind === 'logo') {
            const previous = await db.logo.findUnique({ where: { storeId } });
            const record = await db.logo.upsert({
                where: { storeId },
                create: { ...data, storeId },
                update: data,
            });
            if (previous && previous.key !== key) {
                await deleteObject(previous.key);
            }
            return record;
        }
        const previous = await db.banner.findUnique({ where: { storeId } });
        const record = await db.banner.upsert({
            where: { storeId },
            create: { ...data, storeId },
            update: data,
        });
        if (previous && previous.key !== key) {
            await deleteObject(previous.key);
        }
        return record;
    }
    catch (err) {
        // DB write failed — roll back the object we just uploaded.
        await deleteObject(key);
        throw err;
    }
}
function makeUploadHandler(kind) {
    return async (req, res, next) => {
        try {
            if (!gcsEnabled) {
                res.status(503).json({ error: 'Image storage (GCS) is not configured.' });
                return;
            }
            const file = req.file;
            if (!file) {
                res.status(400).json({ error: 'No file uploaded.' });
                return;
            }
            const store = await findOwnedStore(req.params.id, req.auth?.userId);
            if (!store) {
                res.status(404).json({ error: 'Location not found.' });
                return;
            }
            const record = await commitUpload(kind, store.id, file);
            res.json(kind === 'logo' ? { logo: record } : { banner: record });
        }
        catch (err) {
            next(err);
        }
    };
}
function makeDeleteHandler(kind) {
    return async (req, res, next) => {
        try {
            const store = await findOwnedStore(req.params.id, req.auth?.userId);
            if (!store) {
                res.status(404).json({ error: 'Location not found.' });
                return;
            }
            if (kind === 'logo') {
                const existing = await db.logo.findUnique({ where: { storeId: store.id } });
                if (existing) {
                    await db.logo.delete({ where: { id: existing.id } });
                    await deleteObject(existing.key);
                }
            }
            else {
                const existing = await db.banner.findUnique({ where: { storeId: store.id } });
                if (existing) {
                    await db.banner.delete({ where: { id: existing.id } });
                    await deleteObject(existing.key);
                }
            }
            res.json({ ok: true });
        }
        catch (err) {
            next(err);
        }
    };
}
router.post('/stores/:id/logo', handleUpload, makeUploadHandler('logo'));
router.post('/stores/:id/banner', handleUpload, makeUploadHandler('banner'));
router.delete('/stores/:id/logo', makeDeleteHandler('logo'));
router.delete('/stores/:id/banner', makeDeleteHandler('banner'));
export default router;
//# sourceMappingURL=uploads.js.map