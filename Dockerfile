FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# The home page is prerendered at build time, so the build needs a reachable,
# seeded database and the account pages need their signing key. Both arrive as
# ephemeral BuildKit mounts: unlike ARG/ENV, neither value is retained in image
# metadata or a cached layer. At runtime the container uses compose secrets and
# the compose-internal `db:5432` connection instead.
RUN --mount=type=secret,id=database_url,env=DATABASE_URL,required=true \
    --mount=type=secret,id=auth_secret,env=AUTH_SECRET,required=true \
    npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
