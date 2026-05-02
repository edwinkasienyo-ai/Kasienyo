# syntax=docker/dockerfile:1.6
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=5002 \
    FORCE_HTTPS=true \
    ENABLE_CSP=true
WORKDIR /app
RUN addgroup -S imis && adduser -S imis -G imis
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p uploads && chown -R imis:imis /app
USER imis
EXPOSE 5002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5002/api/health || exit 1
CMD ["node", "src/server.js"]
