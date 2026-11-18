# Oasys Restaurant · Stock & Billing

Ingredient stock, recipes, purchases and GST billing for **Oasys Restaurant (Chennai)**.
The 203 dishes and prices come from the guest-facing [Menu Card](../Menue%20Card/src/menu.js); every dish has a standard recipe,
so **selling a dish deducts its ingredients from stock** and the app knows the food cost of every plate.

It follows the structure of `D:\Live Portfolio\Food Inventory` (Express + Knex + React/Vite, SQLite → Postgres with one env var)
and adds what a working restaurant needs in production.

```
client/    React + Vite UI                     → http://localhost:5190 (dev)
server/    Express 5 + Knex REST API           → http://localhost:4020 (also serves the built UI)
  db/migrations/   portable schema (Knex schema builder, runs on SQLite and Postgres)
  db/seeds/        staff, suppliers, 124 ingredients, 203 dishes + recipes, optional demo trading
  db/seed-data/    menu.json (imported from the Menu Card), ingredients.js, recipes.js
  test/            end-to-end API tests (in-memory SQLite)
shared/billing.mjs GST arithmetic used by both server and POS preview, so they never disagree
scripts/import-menu.mjs  re-imports dishes from the Menu Card
```

## Quick start

```bash
npm run install:all     # root + server + client
cp server/.env.example server/.env
npm run setup           # migrate + seed (14 days of demo trading)
npm run dev             # API on :4020 and UI on :5190
```

Open http://localhost:5190 and sign in as **admin**, **manager** or **cashier**, password `Vasamo@123`
(set `SEED_PASSWORD` before seeding to choose your own; it is required when `NODE_ENV=production`).

Production on one port: `npm run build && npm start` → http://localhost:4020.

> npm 11 blocks install scripts. If `better-sqlite3` fails to load:
> `npm --prefix server approve-scripts better-sqlite3 && npm --prefix server rebuild better-sqlite3`.

## What it does

| Area | Features |
| --- | --- |
| **Dashboard** | Today's sales vs yesterday, bills, food cost %, low/out/expiring stock, stock value, 14-day sales chart, top dishes, ingredients needing attention, dishes that can't be made or have ≤ 5 portions left |
| **Billing (POS)** | Dish grid by menu section with veg/egg/non-veg marks and live "portions left"; dine-in/takeaway/delivery; table, guest, phone, email; discount; optional service charge; CGST + SGST; rupee round-off; preview → confirm; 80 mm thermal print; e-receipt by email |
| **Bills** | Search by bill no / guest / table, filter by day and status, reprint, email, **void with reason** (manager): ingredients go back to stock and the bill stays on record |
| **Stock** | 124 ingredients in kg / L / pcs with par level, reorder quantity, weighted-average cost, supplier, storage, earliest expiry. Record **wastage**, **adjustments** and **physical counts**; **bulk stock take**; full per-ingredient ledger; CSV export |
| **Menu & recipes** | Recipe cost, food cost %, margin and "can make" for every dish; switch dishes off for the day (86); recipe editor with live costing |
| **Purchases** | Goods received (GRN) against supplier invoices: one click adds everything below par; flags price jumps; updates average cost and expiry. Supplier register with GSTIN |
| **Reports** | Sales (by day, payment, order type, menu section, GST collected, voids), dish performance, **stock reconciliation** (opening + purchased − used − wasted ± variance = closing, in ₹), wastage / count / adjustment logs; all exportable to CSV |
| **Staff** | Admin / manager / cashier roles, per-person accounts, password reset, deactivate |

### How stock works

- **Ingredients only change through the ledger** (`stock_movements`): opening, purchase, sale, void, wastage, adjustment, count.
  Each entry stores the change, the balance after it, the unit cost, who did it and why. Quantity is never edited directly.
- **A sale** deducts `recipe quantity × portions` for every ingredient in one transaction with the bill.
- **Book stock is never perfect**, so by default a sale still saves when the recipe says an ingredient is short (`ALLOW_NEGATIVE_STOCK=true`).
  The ingredient goes negative and appears under *Stock → Below zero*. Set it to `false` to refuse such bills.
- **Physical counts** record the variance (counted − book) in quantity and ₹, which is how recipe accuracy and pilferage show up.
- **Average cost** is weighted: `(on hand × avg + received × price) ÷ (on hand + received)`.
- Par levels in the seed come from 2.5 days of simulated usage. Tune them, and the recipe quantities, after a few real stock counts.

### Billing rules (India)

- 5% GST for restaurants, split **CGST 2.5% + SGST 2.5%** (`GST_RATE`), with no input tax credit.
- GST applies after discount and on any service charge. Service charge defaults to 0 and is marked optional, in line with the CCPA guidelines (July 2022).
- Bill numbers are **gap-free, unique per financial year** and ≤ 16 characters as GST requires: `VAS/2627/00001` (`BILL_PREFIX`).
  A failed bill doesn't use up a number. Bills are never deleted, only voided.
- Totals are rounded to the rupee with a visible round-off line. Prices always come from the database, never from the client.
- Put your `GSTIN`, `FSSAI_LICENSE`, address and phone in `server/.env`; they print on every invoice.

## Production checklist

- **Secrets**: set `SEED_PASSWORD` before the first seed, and have every person change their password after signing in (sidebar → Password).
- **HTTPS**: run behind nginx/Caddy with TLS, set `TRUST_PROXY=1`. Session cookies are `Secure` when `NODE_ENV=production`.
  For a plain-HTTP install on the restaurant LAN only, set `COOKIE_SECURE=false`, otherwise sign-in won't stick.
- **Clean install**: `SEED_DEMO_DAYS=0 npm run setup` loads the menu, recipes, suppliers and ingredients with opening stock only, and no demo bills.
  Then do a stock take on day one so book stock matches the shelves.
- **Backups**: SQLite runs in WAL mode. Back up with `sqlite3 server/db/vasamo.sqlite3 ".backup vasamo-$(date +%F).sqlite3"`, or move to Postgres.
- **Health checks**: `GET /api/health` (liveness) and `GET /api/ready` (database reachable).
- The server refuses to start while migrations are pending, validates its configuration at boot, and shuts down cleanly on SIGTERM.

### Security built in

Passwords are hashed with bcrypt (cost 12). Sessions are server-side: an HttpOnly, SameSite=Lax cookie, and only the SHA-256 of the
token is stored. Sign-in is rate-limited. Cross-origin writes are blocked by an Origin check. Helmet sets a strict CSP and other headers.
Every input is validated with zod. Roles are enforced on the server (cashier < manager < admin). A password reset or deactivation
signs that person out everywhere. Logs are structured JSON (pino) with request ids, and cookies, tokens and API keys are redacted.

### Docker

```bash
docker build -t vasamo-stock .
docker run -d -p 4020:4020 -v vasamo-data:/app/server/data \
  -e SEED_PASSWORD='choose-a-strong-one' -e GSTIN=33XXXXXXXXXXXXX -e COOKIE_SECURE=false \
  --name vasamo vasamo-stock
```

The container migrates on start, seeds only an empty database (no demo bills), and keeps the SQLite file on the `vasamo-data` volume.

### Postgres

```
DB_CLIENT=pg
DATABASE_URL=postgres://postgres:postgres@localhost:5432/vasamo
```

Then `npm --prefix server run db:migrate && npm --prefix server run db:seed`. No code changes: `server/src/db.js` makes Postgres return
the same JS types as SQLite. All timestamps are stored as UTC, and reports group by the restaurant's business date (`TIMEZONE`, default Asia/Kolkata).

## Keeping the menu in sync with the Menu Card

```bash
npm run menu:import            # reads ../Menue Card/src/menu.js → server/db/seed-data/menu.json
npm --prefix server run db:reset
```

On a live install, add or edit dishes in **Menu & recipes** instead, since a reset wipes data. A dish without a recipe can still be sold;
it just isn't stock-tracked, and the seed warns about any dish missing a recipe.

## AI Captain / Kitchen Terminal integration

Set `ORDER_API_KEY` (24+ characters) in `server/.env` and send it as `X-Api-Key`:

| Method | Path | |
| --- | --- | --- |
| GET | `/api/integrations/ping` | restaurant name, GST rate |
| GET | `/api/integrations/menu?search=&section=&diet=` | orderable dishes with price and portions left |
| POST | `/api/integrations/orders` | `{ items: [{ name \| dish_id, quantity }], table_no, customer, payment_mode, dry_run }`. Spoken names are matched loosely ("two masala dosas", "chicken briyani", "filter kaapi"); vague ones ("dosa") come back as `ambiguous` with options. `dry_run: true` returns a GST quote; otherwise the bill is created exactly as at the till (`source: ai-captain`) |
| GET | `/api/integrations/orders?since_id=` | kitchen ticket feed (new paid bills with their dishes) for the Kitchen Terminal to poll |

## API (staff, cookie session)

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password` |
| Stock | `GET/POST /api/ingredients`, `GET/PUT/DELETE /api/ingredients/:id`, `POST /api/ingredients/:id/movements` `{type: wastage\|adjustment\|count, quantity, note}`, `POST /api/stock-count`, `GET /api/movements?ingredient_id&type&from&to` |
| Suppliers | `GET/POST /api/suppliers`, `PUT /api/suppliers/:id` |
| Purchases | `GET/POST /api/purchases`, `GET /api/purchases/:id` |
| Menu | `GET /api/sections`, `GET/POST /api/dishes`, `GET/PUT/DELETE /api/dishes/:id`, `PATCH /api/dishes/:id/availability` |
| Bills | `GET /api/bills?date&status&search`, `GET /api/bills/next-number`, `GET/POST /api/bills`, `POST /api/bills/:id/void`, `POST /api/bills/:id/email`, `GET /api/bills/:id/email-preview` |
| Reports | `GET /api/reports/dashboard`, `/sales`, `/dishes`, `/stock` (`?from=YYYY-MM-DD&to=YYYY-MM-DD`) |
| Staff | `GET/POST /api/users`, `PATCH /api/users/:id` (admin) |

## Tests

```bash
npm test
```

19 end-to-end tests run against an in-memory database: GST maths and invoice numbering, auth and roles, CSRF blocking, recipe
deduction and void reversal, gap-free numbering, server-side pricing, 86'd dishes, weighted-average cost, wastage and counts,
ledger-equals-stock, report reconciliation, recipe validation, the integration API with fuzzy name matching, and admin safeguards.
