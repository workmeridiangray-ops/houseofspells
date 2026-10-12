# Witchcraft store - Vendure backend (local preview)

Vendure 3.7.3 (GPLv3), SQLite, no email plugin. Needs Node 20+.

## Run
    npm install
    npm run dev

Admin UI:  http://localhost:3000/admin   (superadmin / superadmin - local testing only)
Shop API:  http://localhost:3000/shop-api
Admin API: http://localhost:3000/admin-api   (GraphQL endpoint, not a web page)

If you see "EADDRINUSE ... 3000", another app is using the port:
    lsof -ti :3000 | xargs kill -9

## Still to do
- Razorpay payment handler, Shiprocket shipping calculator
- Real superadmin password via environment variables
- Branding, product catalog import (stock, HSN/GST, weight)

## Setup (this replaces the "Still to do" list above)
    npm install
    gunzip -k catalog.json.gz        # produces catalog.json (30,617 rows)
    cp .env.example .env             # fill in keys
    npm run dev                      # terminal 1, leave running
    npm run setup:base-data          # terminal 2, once: India zone + tax category
    IMPORT_CONCURRENCY=16 npm run import:catalog   # ~2.5-3 hrs, resumable by SKU

Run the import on a machine that stays on (your laptop or a VPS). If it stops, run it again;
products already imported are skipped.
Still open: real GST rates per HSN (currently 0%), real stock counts (all 0), box dimensions.
