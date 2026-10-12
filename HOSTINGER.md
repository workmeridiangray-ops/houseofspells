# Deploy on Hostinger Cloud

Uses Hostinger's Node.js app feature + the MySQL database that comes with your plan.
(Menu names in hPanel can differ slightly; follow the nearest match.)

## 1. Create the database
hPanel -> Databases -> MySQL Databases -> create a database + user.
Write down: database name, user, password (host is usually `localhost`).

## 2. Create the Node.js app
hPanel -> Websites -> Add Website -> Node.js Apps.
- Import from GitHub (repo: houseofspells, branch main) or upload the zip.
- Node version: 22 (20 also works)
- Build command: `npm install --include=dev && npm run build`
- Start command / entry file: `dist/src/index.js`

## 3. Environment variables (in the Node.js app settings)
```
NODE_ENV=production
DB_HOST=localhost
DB_PORT=3306
DB_USER=<mysql user>
DB_PASSWORD=<mysql password>
DB_NAME=<mysql database name>
DB_SYNCHRONIZE=true
SUPERADMIN_USERNAME=admin
SUPERADMIN_PASSWORD=<a strong password>
COOKIE_SECRET=<long random text>
CRON_SECRET=<random text>
PUBLIC_URL=https://<your-domain>
```
Deploy. Admin panel: https://<your-domain>/admin

## 4. Load the products (over SSH, hPanel -> Advanced -> SSH Access)
```
cd <app folder>
gunzip -k catalog.json.gz
export VENDURE_ADMIN_API_URL=https://<your-domain>/admin-api
export SUPERADMIN_USERNAME=admin SUPERADMIN_PASSWORD=<same password>
npm run setup:base-data
nohup env IMPORT_CONCURRENCY=8 npm run import:catalog > import.log 2>&1 &
tail -f import.log
```
If it stops, run the last command again; finished products are skipped.

## 5. After the first successful start
Set `DB_SYNCHRONIZE=false` (avoid accidental schema changes).
