import {
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    VendureConfig,
} from '@vendure/core';
import { AssetServerPlugin } from '@vendure/asset-server-plugin';
import { AdminUiPlugin } from '@vendure/admin-ui-plugin';
import path from 'path';
import fs from 'fs';

import { razorpayPaymentHandler } from './plugins/razorpay/razorpay-payment-handler';
import { codPaymentHandler } from './plugins/cod-payment-handler';
import { RazorpayPlugin } from './plugins/razorpay/razorpay.plugin';
import { ShiprocketPlugin } from './plugins/shiprocket/shiprocket.plugin';
import { StorefrontPlugin } from './plugins/storefront/storefront.plugin';

const IS_DEV = process.env.NODE_ENV !== 'production';
// storefront/ sits next to src/ (ts-node) or next to dist/ (compiled build)
const STOREFRONT_DIR = [path.join(__dirname, '../storefront'), path.join(__dirname, '../../storefront')].find((d) => fs.existsSync(d)) || path.join(__dirname, '../storefront');

export const config: VendureConfig = {
    apiOptions: {
        port: Number(process.env.PORT) || 3000,
        adminApiPath: 'admin-api',
        shopApiPath: 'shop-api',
        // CORS wide-open for the local/dev preview; tighten before going live
        // (set an explicit origin list via CORS_ORIGINS env in production).
        // Serve the storefront (storefront/ folder) from the same origin as the APIs.
        middleware: [
            {
                route: '/',
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                handler: require('express').static(STOREFRONT_DIR, { index: 'index.html', extensions: ['html'], maxAge: '5m' }),
            },
        ],
        cors: {
            origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : true,
            credentials: true,
        },
    },
    authOptions: {
        tokenMethod: ['bearer', 'cookie'],
        superadminCredentials: {
            // Real deployments MUST set these via env vars — the
            // superadmin/superadmin fallback below is for local dev only.
            identifier: process.env.SUPERADMIN_USERNAME || 'superadmin',
            password: process.env.SUPERADMIN_PASSWORD || 'superadmin',
        },
        cookieOptions: {
            secret: process.env.COOKIE_SECRET || 'witchcraft-dev-secret-change-me',
        },
    },
    dbConnectionOptions: process.env.DB_HOST
        ? {
              // MySQL / MariaDB (Hostinger Cloud and most shared hosts). Set DB_HOST,
              // DB_PORT, DB_USER, DB_PASSWORD, DB_NAME. First run: DB_SYNCHRONIZE=true.
              type: 'mysql',
              host: process.env.DB_HOST,
              port: Number(process.env.DB_PORT) || 3306,
              username: process.env.DB_USER,
              password: process.env.DB_PASSWORD,
              database: process.env.DB_NAME,
              charset: 'utf8mb4',
              synchronize: process.env.DB_SYNCHRONIZE === 'true',
          }
        : IS_DEV
        ? {
              type: 'better-sqlite3',
              database: path.join(__dirname, '../vendure.sqlite'),
              synchronize: true,
          }
        : {
              // Production: point DATABASE_URL at a real Postgres instance
              // (Supabase/Neon/Railway all work) and flip synchronize off
              // once the schema is stable — use migrations instead.
              type: 'postgres',
              url: process.env.DATABASE_URL,
              ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
              // First deploy: set DB_SYNCHRONIZE=true so Vendure creates its tables.
              // Switch to migrations before real customers use the store.
              synchronize: process.env.DB_SYNCHRONIZE === 'true',
              migrations: [path.join(__dirname, '../migrations/*.+(js|ts)')],
          },
    paymentOptions: {
        paymentMethodHandlers: [razorpayPaymentHandler, codPaymentHandler],
    },
    // Custom fields carried over from the old Prisma Product model, so
    // nothing from the 30,616-product SEO-ready catalog gets dropped when
    // moving into Vendure.
    customFields: {
        Product: [
            // External image link (source store CDN). Used instead of re-uploading
            // 30k photos, which a free host with no permanent disk cannot hold.
            { name: 'imageUrl', type: 'string', length: 1000, nullable: true, label: [{ languageCode: 'en' as any, value: 'Image URL' }] },
            { name: 'metaTitle', type: 'string', nullable: true, label: [{ languageCode: 'en' as any, value: 'Meta title' }] },
            { name: 'metaDescription', type: 'text', nullable: true, label: [{ languageCode: 'en' as any, value: 'Meta description' }] },
            { name: 'keywords', type: 'text', nullable: true, label: [{ languageCode: 'en' as any, value: 'SEO keywords (comma-separated)' }] },
            { name: 'imageAltText', type: 'string', nullable: true, label: [{ languageCode: 'en' as any, value: 'Primary image alt text' }] },
            { name: 'sourceStore', type: 'string', nullable: true, label: [{ languageCode: 'en' as any, value: 'Source store' }] },
            { name: 'sourceUrl', type: 'string', nullable: true, label: [{ languageCode: 'en' as any, value: 'Source URL' }] },
            { name: 'hsnCode', type: 'string', nullable: true, label: [{ languageCode: 'en' as any, value: 'HSN code (GST)' }] },
        ],
        ProductVariant: [
            // Vendure stores weight on the variant via its own `weight`-style
            // custom field convention — ours carries the Shiprocket-ready kg value.
            { name: 'weightKg', type: 'float', nullable: true, label: [{ languageCode: 'en' as any, value: 'Weight (kg)' }] },
        ],
        Order: [
            { name: 'shiprocketShipmentId', type: 'string', nullable: true },
            { name: 'shiprocketAwb', type: 'string', nullable: true },
        ],
    },
    plugins: [
        AssetServerPlugin.init({
            route: 'assets',
            assetUploadDir: path.join(__dirname, '../static/assets'),
        }),
        DefaultJobQueuePlugin.init({ useDatabaseForBuffer: true }),
        DefaultSearchPlugin.init({ bufferUpdates: false, indexStockStatus: true }),
        AdminUiPlugin.init({
            route: 'admin',
            port: 3002, // only used by Vendure's dev-watch mode; the built admin is served on the main port
            // Served from the same port as the API (hosts like Render expose one port).
            adminUiConfig: process.env.PUBLIC_URL
                ? { apiHost: 'auto', apiPort: 'auto' } // use whatever origin the admin was loaded from
                : { apiPort: Number(process.env.PORT) || 3000 },
        }),
        RazorpayPlugin,
        ShiprocketPlugin,
        StorefrontPlugin,
    ],
};
