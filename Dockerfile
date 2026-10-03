FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev
COPY --from=builder --chown=node:node /app/dist ./dist
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD ["node", "-e", "process.exit(require('node:fs').existsSync('/tmp/gifory-ready') ? 0 : 1)"]
CMD ["node", "dist/src/index.js"]
