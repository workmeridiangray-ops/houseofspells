// ============================================================
// scripts/import-catalog.ts
//
// Imports the full 30,616-product SEO-ready catalog (catalog.json, produced
// by the old Prisma backend's export_catalog.py from ALL_STORES_SEO_READY.xlsx)
// into a running Vendure instance via its Admin GraphQL API.
//
// Run the Vendure server first (npm run dev in another terminal), then:
//   npm run import:catalog
//
// What it does, per product:
//   1. Ensures a Collection exists for its category (creating facet-free
//      Collections keyed by category -> subcategory, nested).
//   2. Creates the Product (name, description, slug) with translations.
//   3. Sets SEO custom fields (metaTitle, metaDescription, keywords,
//      imageAltText) and sourcing custom fields (sourceStore, sourceUrl).
//   4. Creates one ProductVariant at the real price (createAssets from the
//      external imageUrl, then createProductVariants with that asset and
//      weightKg custom field).
//   5. Assigns the Product to its category Collection.
//
// Resumable: products are matched by SKU on each run, and anything already
// imported is skipped — safe to re-run after an interruption or to pick up
// new rows from a refreshed catalog.json.
// ============================================================

import fs from 'fs';
import path from 'path';
import { GraphQLClient, gql } from 'graphql-request';
import { setAuthToken, uploadRemoteImageAsAsset } from './upload-remote-asset';

const ADMIN_API_URL = process.env.VENDURE_ADMIN_API_URL || 'http://localhost:3000/admin-api';
const CATALOG_PATH = process.env.CATALOG_PATH || path.join(__dirname, '../catalog.json');
const BATCH_SIZE = 25; // keep modest — each product is several sequential mutations

interface CatalogRow {
    name: string;
    sku: string;
    price: number;
    compareAtPrice: number | null;
    currency: string;
    category: string;
    subcategory: string | null;
    subSubcategory: string | null;
    tags: string[];
    description: string;
    weightKg: number | null;
    imageUrl: string;
    productUrl: string | null;
    sourceStore: string;
    sourceDomain: string | null;
    metaTitle: string | null;
    metaDescription: string | null;
    keywords: string | null;
    imageAltText: string | null;
}

function slugify(input: string): string {
    return input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 80);
}

// How many products to import in parallel. Each import is mostly waiting on
// network I/O (image download + re-upload, several sequential GraphQL
// calls), so this is the main lever for throughput — a sequential run on
// this catalog measured ~1.26s/product (~10-11 hours for all 30,616);
// concurrency cuts that roughly proportionally up to where the Vendure
// server's own request handling becomes the bottleneck. 8 is a reasonable
// default for a local dev server; raise it if the server keeps up (watch
// for rising error rates — that's the sign to back off).
const CONCURRENCY = Number(process.env.IMPORT_CONCURRENCY) || 8;

async function main() {
    console.log(`Reading catalog from ${CATALOG_PATH}...`);
    const rows: CatalogRow[] = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
    console.log(`Loaded ${rows.length} products.`);
    // A few catalog rows have no SKU. Vendure requires one, so build a stable one
    // (same input -> same SKU) so re-runs still recognise already-imported rows.
    for (const r of rows) {
        if (!r.sku) r.sku = `WS-${slugify(r.name)}-${slugify(r.sourceStore || 'x')}`.slice(0, 90);
    }

    const client = new GraphQLClient(ADMIN_API_URL);
    await login(client);

    const existingSkus = await fetchExistingSkus(client);
    console.log(`${existingSkus.size} products already imported — will skip those.`);
    console.log(`Importing with concurrency = ${CONCURRENCY} (set IMPORT_CONCURRENCY to change).`);

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let processed = 0;
    const startTime = Date.now();

    async function worker(row: CatalogRow) {
        if (existingSkus.has(row.sku)) {
            skipped++;
            return;
        }
        try {
            // Memoized per-category (see ensureCollection/ensureCategoryFacetValue),
            // so concurrent workers hitting the same category just share the cache
            // after the first one creates it.
            await ensureCollection(client, row.category);
            const facetValueId = await ensureCategoryFacetValue(client, row.category);
            await importProduct(client, row, facetValueId);
            imported++;
        } catch (err: any) {
            failed++;
            console.error(`Failed to import "${row.name}" (sku ${row.sku}): ${err.message}`);
        }
    }

    // Simple fixed-size worker pool over a shared index cursor — keeps
    // CONCURRENCY requests in flight at all times rather than batching in
    // lockstep chunks (which would have every batch wait on its slowest row).
    let nextIndex = 0;
    async function runWorkerLoop() {
        while (true) {
            const i = nextIndex++;
            if (i >= rows.length) return;
            await worker(rows[i]);
            processed++;
            if (processed % 200 === 0 || processed === rows.length) {
                const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
                console.log(`Progress: ${processed}/${rows.length} (imported ${imported}, skipped ${skipped}, failed ${failed}) — ${elapsedMin} min elapsed`);
            }
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => runWorkerLoop()));

    console.log(`\nDone. Imported ${imported}, skipped ${skipped} (already present), failed ${failed}.`);
    if (failed > 0) {
        console.log('Re-run the script to retry failed rows — it skips anything already imported by SKU.');
    }
}

async function login(client: GraphQLClient) {
    const identifier = process.env.SUPERADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPERADMIN_PASSWORD || 'superadmin';

    const mutation = gql`
        mutation Login($username: String!, $password: String!) {
            login(username: $username, password: $password) {
                __typename
                ... on CurrentUser {
                    id
                }
                ... on ErrorResult {
                    errorCode
                    message
                }
            }
        }
    `;

    const res: any = await client.rawRequest(mutation, { username: identifier, password });
    const authHeader = res.headers.get('vendure-auth-token');
    if (authHeader) {
        client.setHeader('Authorization', `Bearer ${authHeader}`);
        setAuthToken(authHeader); // so the multipart asset uploader can authenticate too
    }
    if (res.data?.login?.__typename !== 'CurrentUser') {
        throw new Error(`Login failed: ${JSON.stringify(res.data?.login)}`);
    }
    console.log('Authenticated as', identifier);
}

async function fetchExistingSkus(client: GraphQLClient): Promise<Set<string>> {
    const query = gql`
        query ExistingSkus($skip: Int!, $take: Int!) {
            productVariants(options: { skip: $skip, take: $take }) {
                items {
                    sku
                }
                totalItems
            }
        }
    `;

    const skus = new Set<string>();
    let skip = 0;
    const take = 1000;
    while (true) {
        const data: any = await client.request(query, { skip, take });
        for (const v of data.productVariants.items) skus.add(v.sku);
        skip += take;
        if (skip >= data.productVariants.totalItems) break;
    }
    return skus;
}

// Collections are created flat, one per top-level category, and populated
// via a facetValue filter (Vendure's standard mechanism) rather than a
// manual product list — so once the "category" FacetValue is applied to a
// Product, it's automatically included without a second mutation per product.
//
// Memoized by the IN-FLIGHT PROMISE, not just the resolved id — with
// CONCURRENCY workers running, several can hit a brand-new category in the
// same tick, and without this they'd race to create duplicate Collections
// instead of all awaiting the same creation.
const collectionIdPromiseByCategory = new Map<string, Promise<string>>();
async function ensureCollection(client: GraphQLClient, category: string): Promise<string> {
    const cached = collectionIdPromiseByCategory.get(category);
    if (cached) return cached;
    const promise = ensureCollectionUncached(client, category);
    collectionIdPromiseByCategory.set(category, promise);
    return promise;
}

async function ensureCollectionUncached(client: GraphQLClient, category: string): Promise<string> {
    const slug = slugify(category);

    const findQuery = gql`
        query FindCollection($slug: String!) {
            collection(slug: $slug) {
                id
            }
        }
    `;
    const existing: any = await client.request(findQuery, { slug }).catch(() => null);
    if (existing?.collection?.id) return existing.collection.id;

    const facetValueId = await ensureCategoryFacetValue(client, category);

    const createMutation = gql`
        mutation CreateCollection($input: CreateCollectionInput!) {
            createCollection(input: $input) {
                id
            }
        }
    `;
    const result: any = await client.request(createMutation, {
        input: {
            translations: [{ languageCode: 'en', name: category, slug, description: '' }],
            filters: [
                {
                    code: 'facet-value-filter',
                    arguments: [
                        { name: 'facetValueIds', value: JSON.stringify([facetValueId]) },
                        { name: 'containsAny', value: 'false' },
                    ],
                },
            ],
            isPrivate: false,
        },
    });
    return result.createCollection.id;
}

let categoryFacetIdPromise: Promise<string> | null = null;
const facetValueIdPromiseByCategory = new Map<string, Promise<string>>();

// One shared "Category" Facet, with one FacetValue per catalog category
// (e.g. "Pooja & Devotional", "Crystals"). Applying that FacetValue to a
// Product is what makes the matching Collection's filter pick it up.
// Same in-flight-promise memoization as ensureCollection, for the same
// concurrency-safety reason.
async function ensureCategoryFacetValue(client: GraphQLClient, category: string): Promise<string> {
    const cached = facetValueIdPromiseByCategory.get(category);
    if (cached) return cached;
    const promise = ensureCategoryFacetValueUncached(client, category);
    facetValueIdPromiseByCategory.set(category, promise);
    return promise;
}

async function ensureCategoryFacetId(client: GraphQLClient): Promise<string> {
    const findFacetQuery = gql`
        query FindFacet {
            facets(options: { filter: { code: { eq: "category" } } }) {
                items {
                    id
                }
            }
        }
    `;
    const found: any = await client.request(findFacetQuery);
    if (found.facets.items.length) {
        return found.facets.items[0].id;
    }

    const createFacetMutation = gql`
        mutation CreateFacet($input: CreateFacetInput!) {
            createFacet(input: $input) {
                id
            }
        }
    `;
    const created: any = await client.request(createFacetMutation, {
        input: {
            code: 'category',
            isPrivate: false,
            translations: [{ languageCode: 'en', name: 'Category' }],
        },
    });
    return created.createFacet.id;
}

async function ensureCategoryFacetValueUncached(client: GraphQLClient, category: string): Promise<string> {
    if (!categoryFacetIdPromise) {
        categoryFacetIdPromise = ensureCategoryFacetId(client);
    }
    const categoryFacetId = await categoryFacetIdPromise;

    const createFacetValueMutation = gql`
        mutation CreateFacetValue($input: [CreateFacetValueInput!]!) {
            createFacetValues(input: $input) {
                id
            }
        }
    `;
    const slug = slugify(category);
    const result: any = await client.request(createFacetValueMutation, {
        input: [
            {
                facetId: categoryFacetId,
                code: slug,
                translations: [{ languageCode: 'en', name: category }],
            },
        ],
    });
    return result.createFacetValues[0].id;
}

async function importProduct(client: GraphQLClient, row: CatalogRow, facetValueId: string) {
    const slug = `${slugify(row.name)}-${row.sku}`.slice(0, 95);

    const createProductMutation = gql`
        mutation CreateProduct($input: CreateProductInput!) {
            createProduct(input: $input) {
                id
            }
        }
    `;
    const productResult: any = await client.request(createProductMutation, {
        input: {
            translations: [
                {
                    languageCode: 'en',
                    name: row.name,
                    slug,
                    description: row.description || '',
                },
            ],
            facetValueIds: [facetValueId],
            customFields: {
                metaTitle: row.metaTitle || undefined,
                metaDescription: row.metaDescription || undefined,
                keywords: row.keywords || (row.tags || []).join(', '),
                imageAltText: row.imageAltText || row.name,
                imageUrl: row.imageUrl || undefined,
                sourceStore: row.sourceStore || undefined,
                sourceUrl: row.productUrl || undefined,
            },
        },
    });
    const productId = productResult.createProduct.id;

    // Pull the image in from its external URL and re-upload it as a Vendure
    // Asset (createAssets only accepts a real multipart file, not a URL
    // string — see upload-remote-asset.ts). This hits the source CDN for
    // every product, so it's the slow part of the import — expected for a
    // one-time catalog load.
    const assetId = process.env.IMPORT_UPLOAD_IMAGES === 'true'
        ? (await uploadRemoteImageAsAsset(row.imageUrl)) || undefined
        : undefined;

    if (assetId) {
        const updateProductMutation = gql`
            mutation UpdateProductAssets($input: UpdateProductInput!) {
                updateProduct(input: $input) {
                    id
                }
            }
        `;
        await client.request(updateProductMutation, {
            input: { id: productId, featuredAssetId: assetId, assetIds: [assetId] },
        });
    }

    const createVariantMutation = gql`
        mutation CreateVariants($input: [CreateProductVariantInput!]!) {
            createProductVariants(input: $input) {
                id
            }
        }
    `;
    await client.request(createVariantMutation, {
        input: [
            {
                productId,
                sku: row.sku,
                price: Math.round(row.price * 100), // paise
                translations: [{ languageCode: 'en', name: row.name }],
                featuredAssetId: assetId,
                assetIds: assetId ? [assetId] : [],
                customFields: {
                    weightKg: row.weightKg ?? undefined,
                },
                // stock starts at 0 — real warehouse counts are a known gap,
                // same as they were in the Prisma backend.
                stockOnHand: 0,
                trackInventory: 'TRUE',
            },
        ],
    });

    // Nothing further needed here — applying facetValueIds to the Product
    // above is what makes its category Collection's filter pick it up
    // automatically (Collections re-evaluate their filters on a schedule /
    // after mutations, per Vendure's normal behaviour).
}

main().catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
});
