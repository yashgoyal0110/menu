export const PRODUCT_CATEGORIES = ['Repairs', 'Plans', 'AddOns'] as const

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]
