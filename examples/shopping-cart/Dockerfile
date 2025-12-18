# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./
COPY tsconfig.json tsconfig.build.json tsup.config.ts ./
COPY src ./src

# Build root package first (needs dev deps for tsup)
RUN npm ci
RUN npm run build

# Copy example files
COPY examples/shopping-cart/package.json examples/shopping-cart/
COPY examples/shopping-cart/tsconfig.json examples/shopping-cart/tsconfig.build.json examples/shopping-cart/
COPY examples/shopping-cart/src examples/shopping-cart/src
COPY examples/shopping-cart/openapi.yml examples/shopping-cart/

# Install dependencies and build example
WORKDIR /app/examples/shopping-cart
# Use npm install instead of npm ci to resolve dependencies from registry
# This avoids issues with local package links in package-lock.json
RUN npm install
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app/examples/shopping-cart

# Copy built artifacts from builder
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/
COPY --from=builder /app/examples/shopping-cart/dist ./dist
COPY --from=builder /app/examples/shopping-cart/package.json ./
COPY --from=builder /app/examples/shopping-cart/openapi.yml ./

# Install only production dependencies
RUN npm install --omit=dev

EXPOSE 3000

# Health check
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000 || exit 1

CMD ["node", "dist/index.js"]
