// ============================================================
// Storefront catalog API  (GET /store/...)
//
// Reads straight from the database so browsing, search and category
// filtering work for the whole 30k catalog immediately, without waiting on
// Vendure's background search-index / collection jobs (which are slow on
// shared hosting). Cart, checkout and payments still use the normal
// Vendure Shop API.
// ============================================================
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { PluginCommonModule, TransactionalConnection, VendurePlugin } from '@vendure/core';
import * as fs from 'fs';
import * as path from 'path';

// MRP (struck-through price) lookup: source product URL -> [selling price, MRP], in rupees.
// Only genuine-looking gaps (5-40%) are included. Shown only while the selling price still matches.
const MRP: Record<string, [number, number]> = (() => {
    for (const rel of ['../../../data/mrp.json', '../../data/mrp.json', '../data/mrp.json']) {
        const p = path.join(__dirname, rel);
        if (fs.existsSync(p)) {
            try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* ignore */ }
        }
    }
    return {};
})();

const BASE = `
  FROM product p
  JOIN product_translation pt ON pt.baseId = p.id AND pt.languageCode = 'en'
  JOIN (SELECT productId, MIN(id) AS vid FROM product_variant WHERE deletedAt IS NULL AND enabled = 1 GROUP BY productId) fv ON fv.productId = p.id
  JOIN product_variant v ON v.id = fv.vid
  JOIN product_variant_price vp ON vp.variantId = v.id AND vp.channelId = 1
  LEFT JOIN product_facet_values_facet_value pf ON pf.productId = p.id
  LEFT JOIN facet_value fvl ON fvl.id = pf.facetValueId
  LEFT JOIN facet_value_translation fvt ON fvt.baseId = fvl.id AND fvt.languageCode = 'en'
  WHERE p.deletedAt IS NULL AND p.enabled = 1`;

const COLS = `p.id AS productId, pt.name, pt.slug, v.id AS variantId, vp.price AS price,
  p.customFieldsImageurl AS image, p.customFieldsSourceurl AS srcUrl, fvl.code AS categorySlug, fvt.name AS category`;

function card(r: any) {
    const price = Number(r.price) / 100;
    const m = r.srcUrl ? MRP[r.srcUrl] : undefined;
    const mrp = m && Math.round(price) === m[0] ? m[1] : null;
    return {
        mrp,
        off: mrp ? Math.round(((mrp - price) / mrp) * 100) : null,
        id: Number(r.variantId),
        productId: Number(r.productId),
        slug: r.slug,
        name: r.name,
        price: Number(r.price) / 100, // Vendure stores minor units
        image: r.image || '',
        category: r.category || 'Other',
        categorySlug: r.categorySlug || '',
    };
}

const cache = new Map<string, { at: number; data: any }>();
const TTL = 120000;
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit.data);
    return fn().then((data) => {
        if (cache.size > 500) cache.clear();
        cache.set(key, { at: Date.now(), data });
        return data;
    });
}

@Controller('store')
export class StoreController {
    private catCache: { at: number; data: any[] } | null = null;

    constructor(private connection: TransactionalConnection) {}

    private q(sql: string, params: any[] = []): Promise<any[]> {
        return this.connection.rawConnection.query(sql, params);
    }

    @Get('config')
    config(@Res({ passthrough: true }) res: any) {
        res.set('Cache-Control', 'public, max-age=60');
        return { razorpayKeyId: process.env.RAZORPAY_KEY_ID || null, cod: true };
    }

    @Get('categories')
    async categories(@Res({ passthrough: true }) res: any) {
        res.set('Cache-Control', 'public, max-age=300');
        if (this.catCache && Date.now() - this.catCache.at < 600000) return this.catCache.data;
        const rows = await this.q(
            `SELECT fvl.code AS slug, fvt.name AS name, COUNT(DISTINCT p.id) AS n
             FROM product p
             JOIN product_facet_values_facet_value pf ON pf.productId = p.id
             JOIN facet_value fvl ON fvl.id = pf.facetValueId
             JOIN facet_value_translation fvt ON fvt.baseId = fvl.id AND fvt.languageCode = 'en'
             WHERE p.deletedAt IS NULL AND p.enabled = 1
             GROUP BY fvl.code, fvt.name ORDER BY n DESC`,
        );
        const data = rows.map((r) => ({ slug: r.slug, name: r.name, count: Number(r.n) }));
        this.catCache = { at: Date.now(), data };
        return data;
    }

    @Get('catalog')
    async catalog(
        @Query('cat') cat: string,
        @Query('q') term: string,
        @Query('sort') sort: string,
        @Query('skip') skipRaw: string,
        @Query('take') takeRaw: string,
        @Res({ passthrough: true }) res: any,
    ) {
        res.set('Cache-Control', 'public, max-age=60');
        const skip = Math.max(0, parseInt(skipRaw, 10) || 0);
        const take = Math.min(60, Math.max(1, parseInt(takeRaw, 10) || 30));
        const where: string[] = [];
        const params: any[] = [];
        if (cat) { where.push('fvl.code = ?'); params.push(cat); }
        if (term && term.trim()) {
            where.push('pt.name LIKE ?');
            params.push('%' + term.trim().replace(/[%_]/g, '') + '%');
        }
        const extra = where.length ? ' AND ' + where.join(' AND ') : '';
        const order =
            sort === 'price-asc' ? 'vp.price ASC, p.id ASC'
            : sort === 'price-desc' ? 'vp.price DESC, p.id ASC'
            : sort === 'name-asc' ? 'pt.name ASC, p.id ASC'
            : 'p.id DESC';
        return cached(JSON.stringify([cat, term, sort, skip, take]), async () => {
            const [{ n }] = await this.q(`SELECT COUNT(DISTINCT p.id) AS n ${BASE}${extra}`, params);
            const rows = await this.q(
                `SELECT ${COLS} ${BASE}${extra} GROUP BY p.id ORDER BY ${order} LIMIT ? OFFSET ?`,
                [...params, take, skip],
            );
            return { total: Number(n), items: rows.map(card) };
        });
    }

    @Get('picks')
    async picks(@Res({ passthrough: true }) res: any) {
        res.set('Cache-Control', 'public, max-age=300');
        const rows = await cached('picks', () => this.q(`SELECT ${COLS} ${BASE} GROUP BY p.id ORDER BY p.id DESC LIMIT 400`));
        // spread picks across categories, newest first
        const seen: Record<string, number> = {};
        const out: any[] = [];
        for (const r of rows) {
            const k = r.categorySlug || '';
            if ((seen[k] || 0) >= 3 || !r.image) continue;
            seen[k] = (seen[k] || 0) + 1;
            out.push(card(r));
            if (out.length >= 12) break;
        }
        return out;
    }

    @Get('product/:slug')
    async product(@Param('slug') slug: string, @Res({ passthrough: true }) res: any) {
        res.set('Cache-Control', 'public, max-age=60');
        const rows = await this.q(
            `SELECT ${COLS}, pt.description AS description, pt.name AS pname,
                    p.customFieldsMetatitle AS metaTitle, p.customFieldsMetadescription AS metaDescription,
                    p.customFieldsKeywords AS keywords, p.customFieldsImagealttext AS alt, v.sku AS sku,
                    v.customFieldsWeightkg AS weightKg
             ${BASE} AND pt.slug = ? GROUP BY p.id LIMIT 1`,
            [slug],
        );
        if (!rows.length) {
            res.status(404);
            return { error: 'not_found' };
        }
        const r = rows[0];
        const related = r.categorySlug
            ? await this.q(
                  `SELECT ${COLS} ${BASE} AND fvl.code = ? AND p.id <> ? GROUP BY p.id ORDER BY p.id DESC LIMIT 8`,
                  [r.categorySlug, r.productId],
              )
            : [];
        return {
            ...card(r),
            description: r.description || '',
            metaTitle: r.metaTitle || r.name,
            metaDescription: r.metaDescription || '',
            keywords: r.keywords || '',
            alt: r.alt || r.name,
            sku: r.sku,
            weightKg: r.weightKg == null ? null : Number(r.weightKg),
            related: related.map(card),
        };
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [StoreController],
})
export class StorefrontPlugin {}
