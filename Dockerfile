# The whole demo as ONE service (for Railway or any Docker host):
#   /        the Captain: tablet app, /kds (Kitchen Display), /waiter (Waiter screen), the ordering API, the voice link
#   /stock   Stock Management (its web app and API)
# The Captain and Stock Management share one database file on the mounted disk, so nothing in the code changes.
# See deploy/README.md for the steps and variables.
FROM node:22-bookworm-slim

# better-sqlite3 (Stock Management) is built from source
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- Stock Management: API ----
COPY ["Stock Management/shared", "/app/stock/shared"]
COPY ["Stock Management/server/package.json", "Stock Management/server/package-lock.json", "/app/stock/server/"]
RUN cd /app/stock/server && npm ci --omit=dev
COPY ["Stock Management/server", "/app/stock/server"]

# ---- Stock Management: web app, built to live under /stock/ ----
COPY ["Stock Management/client/package.json", "Stock Management/client/package-lock.json", "/app/stock/client/"]
RUN cd /app/stock/client && npm ci
COPY ["Stock Management/client", "/app/stock/client"]
RUN cd /app/stock/client && VITE_BASE=/stock/ npm run build && rm -rf node_modules

# ---- the Captain (its server is part of the build tool, so it keeps its dev dependencies) ----
COPY ["The Captian/package.json", "The Captian/package-lock.json", "/app/captain/"]
RUN cd /app/captain && npm ci
COPY ["The Captian", "/app/captain"]
RUN cd /app/captain && npm run build

# the dishes' dietary tags the Captain reads
COPY ["Menue Card", "/app/menu-card"]

# ---- the front door and the start script ----
COPY deploy /app/deploy

ENV NODE_ENV=production
# the shared disk: attach a Railway volume at /data (a Dockerfile VOLUME line is not allowed on Railway)
EXPOSE 8080
CMD ["node", "deploy/start.mjs"]
