# ---- build native deps (better-sqlite3) ----
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci

# ---- runtime ----
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY server ./server
COPY public ./public

RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/index.js"]
