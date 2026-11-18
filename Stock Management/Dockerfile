# Single image: builds the React UI, then runs the API which also serves it.
#   docker build -t vasamo-stock .
#   docker run -p 4020:4020 -v vasamo-data:/app/server/data -e SEED_PASSWORD=... vasamo-stock
FROM node:22-bookworm-slim AS client
WORKDIR /app
COPY shared ./shared
COPY client/package*.json ./client/
RUN npm --prefix client ci
COPY client ./client
RUN npm --prefix client run build

FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=4020 \
    SQLITE_FILE=./data/vasamo.sqlite3 \
    SEED_DEMO_DAYS=0
WORKDIR /app
COPY shared ./shared
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server ./server
COPY --from=client /app/client/dist ./client/dist
RUN mkdir -p server/data && chown -R node:node server/data
USER node
WORKDIR /app/server
EXPOSE 4020
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Applies pending migrations, seeds only an empty database, then starts.
CMD ["sh", "-c", "npx knex migrate:latest && node -e \"const k=require('knex')(require('./knexfile'));k('users').count({n:'*'}).first().then(r=>{process.exit(Number(r.n)?0:1)})\" || npx knex seed:run; exec node src/index.js"]
