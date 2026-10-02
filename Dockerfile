# syntax=docker/dockerfile:1.7
# ── build: install everything, test-free production build of client + server ──
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── runtime deps only ──
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/protocol/package.json packages/protocol/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ── runtime ──
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 STATIC_DIR=/app/public
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/client/dist ./public
COPY THIRD_PARTY_NOTICES ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
