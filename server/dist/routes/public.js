import { Router } from 'express';
import { z } from 'zod';
import { availabilitySnapshot } from '../lib/availability.js';
import { db } from '../prisma.js';
/**
 * Public, unauthenticated store pages. These power the customer-facing catalog
 * that a store shares via link/QR. Only ACTIVE, non-deleted stores are exposed.
 * Ported from the Next.js `lib/queries/store.ts` + `stores/[city]` pages.
 */
const router = Router();
const cityParams = z.object({
    city: z.string().min(1),
});
const storeParams = z.object({
    city: z.string().min(1),
    idOrSlug: z.string().min(1),
});
// GET /public/stores/:city — list ACTIVE stores in a city.
router.get('/stores/:city', async (req, res, next) => {
    try {
        const { city } = cityParams.parse(req.params);
        const stores = await db.store.findMany({
            where: { citySlug: city, deletedAt: null, status: 'ACTIVE' },
            orderBy: { name: 'asc' },
            include: { logo: true },
        });
        res.json({
            stores: stores.map((store) => ({
                id: store.id,
                name: store.name,
                slug: store.slug,
                cityName: store.cityName,
                address: store.address,
                logoUrl: store.logo?.url ?? null,
            })),
        });
    }
    catch (err) {
        next(err);
    }
});
// GET /public/stores/:city/:idOrSlug — one ACTIVE store (matched by slug or id
// within the city) with its products, logo and banner. 404 if not found.
router.get('/stores/:city/:idOrSlug', async (req, res, next) => {
    try {
        const { city, idOrSlug } = storeParams.parse(req.params);
        const store = await db.store.findFirst({
            where: {
                citySlug: city,
                deletedAt: null,
                status: 'ACTIVE',
                OR: [{ slug: idOrSlug }, { id: idOrSlug }],
            },
            include: {
                logo: true,
                banner: true,
                // Match the Next.js page: catalog grouped client-side, ordered by category.
                products: {
                    where: { deletedAt: null },
                    orderBy: { category: 'asc' },
                },
                businessHours: true,
                availabilityResources: {
                    where: { active: true },
                    orderBy: { createdAt: 'asc' },
                },
                availabilityExceptions: true,
            },
        });
        if (!store) {
            res.status(404).json({ error: 'Store not found.' });
            return;
        }
        res.json({
            store: {
                id: store.id,
                name: store.name,
                slug: store.slug,
                description: store.description,
                address: store.address,
                citySlug: store.citySlug,
                cityName: store.cityName,
                province: store.province,
                phone: store.phone,
                logoUrl: store.logo?.url ?? null,
                bannerUrl: store.banner?.url ?? null,
                availability: availabilitySnapshot(store),
                products: store.products.map((product) => ({
                    id: product.id,
                    name: product.name,
                    price: product.price,
                    description: product.description,
                    category: product.category,
                })),
            },
        });
    }
    catch (err) {
        next(err);
    }
});
export default router;
//# sourceMappingURL=public.js.map