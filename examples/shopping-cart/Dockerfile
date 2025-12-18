FROM node:20-alpine AS builder

WORKDIR /app

# Copy library (root) files so the local file dependency ../.. resolves
COPY package*.json tsconfig*.json tsup.config.ts ./
COPY src ./src

# Install root package dependencies and build it
RUN npm ci
RUN npm run build

# Copy shopping-cart example sources
COPY examples/shopping-cart/package*.json ./examples/shopping-cart/
COPY examples/shopping-cart/tsconfig.json ./examples/shopping-cart/
COPY examples/shopping-cart/src ./examples/shopping-cart/src
COPY examples/shopping-cart/openapi.yml ./examples/shopping-cart/openapi.yml

# Install example dependencies (resolves file:../.. against /app)
RUN cd examples/shopping-cart && npm ci

FROM node:20-alpine AS runner

WORKDIR /app/examples/shopping-cart
ENV NODE_ENV=production

# Provide the locally linked library and its dependencies so the symlink installed from file:../.. resolves
COPY --from=builder /app/package*.json /app/
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/dist /app/dist

# Copy runtime artifacts
COPY --from=builder /app/examples/shopping-cart/node_modules ./node_modules
COPY --from=builder /app/examples/shopping-cart/src ./src
COPY --from=builder /app/examples/shopping-cart/package*.json ./
COPY --from=builder /app/examples/shopping-cart/tsconfig.json ./tsconfig.json
COPY --from=builder /app/examples/shopping-cart/openapi.yml ./openapi.yml

EXPOSE 3000

CMD ["npm", "run", "start"]
