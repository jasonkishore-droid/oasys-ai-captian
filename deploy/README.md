# Deploy the demo on Railway (one service)

One Railway service runs everything:

| Address | What |
|---|---|
| `https://<your-domain>/` | the Captain tablet app (sign in with the table number and password, as on the tablet) |
| `/kds` | Kitchen Display |
| `/waiter` | Waiter screen |
| `/stock` | Stock Management (web app and API) |

Inside the container: Stock Management on `:4020`, the Captain on `:5181`, and a small front door (`deploy/gateway.mjs`) on the public `$PORT`.
They share one SQLite database on the mounted disk, so the Captain's kitchen and stock steps work as on your PC.

## Steps

1. Push this repo (with `Dockerfile`, `railway.json`, `deploy/`) to GitHub.
2. Railway: **New Project → Deploy from GitHub repo**, pick the repo and branch. It finds the `Dockerfile` and `railway.json`.
3. In the service: **Volumes → New Volume**, mount path **`/data`**. This keeps the databases and the waiters' pictures across redeploys.
4. **Variables** (service → Variables):

   | Variable | Value |
   |---|---|
   | `SEED_PASSWORD` | the password for the Stock Management accounts `admin`, `manager`, `cashier` (needed on the first start) |
   | `GEMINI_API_KEY` | your Gemini key (for the voice chat) |
   | `GEMINI_LIVE_MODEL`, `GEMINI_LIVE_VOICE` | optional; same names as in `The Captian/.env.example` |
   | `RESTAURANT_NAME` | optional, e.g. `Oasys Restaurant` |

   Do not add `PORT`: Railway sets it.
5. **Settings → Networking → Generate Domain.** Open it, then `/kds`, `/waiter`, `/stock`.

The first start builds the image (several minutes: the Captain's dependencies are large), creates Stock Management's database and
seeds the menu, recipes and accounts. Later starts are quick.

## Logins

- **Tablet:** any table number, password `1234`.
- **Kitchen Display:** `kds` / `kds123`.
- **Waiter screen:** `Shankar` / `s123` (add more with `npm run waiter:add` in `The Captian`, or from the service's shell).
- **Stock Management:** `admin`, `manager` or `cashier` with the `SEED_PASSWORD` you set.

These demo logins are in the source. Change them before anyone real uses it.

## What does not work in the hosted demo

- **Receipt printing.** The Bluetooth printer is reached from a browser on the restaurant's own device, so "Print receipt" has nothing to print on.
- **Speaker recognition and desktop control.** They are Python helpers for a local machine and are switched off.
- Camera and microphone work, because Railway serves the page over https.

## Not tested

This setup was written and checked piece by piece (the Stock Management web app builds under `/stock/`, and the front door routes the
Captain, `/kds`, `/waiter` and `/stock` correctly against the local servers), but the Docker image itself has not been built, and
the voice WebSocket through the front door has not been tried. Expect to fix a small thing or two on the first deploy.
