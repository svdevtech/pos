
# ---- deps ------------------------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 3D floor plan ----------------------------------------------------------
# Its own Vite/TypeScript program (see frontend/fnb3d/src/Scene.tsx for why); it builds into
# public/fnb3d, which the Next build then ships like any static file.
FROM node:22-alpine AS fnb3d
WORKDIR /app/fnb3d
COPY fnb3d/package.json fnb3d/package-lock.json ./
RUN npm ci
COPY fnb3d/ ./
RUN npm run build

# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
ARG BACKEND_INTERNAL_URL=http://backend:8090
ARG NEXT_PUBLIC_LIFF_ID=
ARG NEXT_PUBLIC_LINE_MOCK=false
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL \
    NEXT_PUBLIC_LIFF_ID=$NEXT_PUBLIC_LIFF_ID \
    NEXT_PUBLIC_LINE_MOCK=$NEXT_PUBLIC_LINE_MOCK \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=fnb3d /app/public/fnb3d ./public/fnb3d
RUN npm run build

# ---- runner ----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3010 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3010
CMD ["node", "server.js"]
