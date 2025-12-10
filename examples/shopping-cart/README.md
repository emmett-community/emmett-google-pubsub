# Shopping Cart Example - Firestore + Realtime DB + PubSub

Complete event-sourced shopping cart example using:

- **Event Store**: Google Firestore (via `@emmett-community/emmett-google-firestore`)
- **Projections**: Google Realtime Database (via `@emmett-community/emmett-google-realtime-db`)
- **Message Bus**: Google Cloud Pub/Sub (via `@emmett-community/emmett-google-pubsub`)
- **API**: Express.js with OpenAPI validation
- **Testing**: Unit, integration, and E2E tests

## Architecture

### Event Sourcing Pattern

```
┌─────────────────┐         ┌──────────────────┐
│  HTTP Commands  │────────▶│  EventStore      │
│  (POST/DELETE)  │         │  (Firestore)     │
└─────────────────┘         └──────────────────┘
                                     │
                                     │ wireRealtimeDBProjections
                                     │
                                     ▼
                            ┌──────────────────┐      ┌──────────────────┐
                            │  Projections     │      │  Message Bus     │
                            │  (Realtime DB)   │      │  (PubSub)        │
                            └──────────────────┘      └──────────────────┘
                                     │                         │
┌─────────────────┐                 │                         │
│  HTTP Queries   │◀────────────────┘                         │
│  (GET)          │                                            │
└─────────────────┘                                            ▼
                                                      ┌──────────────────┐
                                                      │  Event Handler   │
                                                      │  (Console Log)   │
                                                      └──────────────────┘
```

### Two Projections

This example demonstrates **two different projections** from the same event stream:

#### 1. ShoppingCartDetails (Full Data)

**Endpoint**: `GET /clients/{clientId}/shopping-carts/current`

**Contains**:
- Full product item list
- Total amount
- Product count
- Cart status (Opened/Confirmed/Cancelled)
- Timestamps

**Use Case**: Display complete cart details to user

**Example Response**:
```json
{
  "id": "shopping_cart:client-123:current",
  "clientId": "client-123",
  "productItems": [
    { "productId": "product-1", "quantity": 2, "unitPrice": 100 },
    { "productId": "product-2", "quantity": 1, "unitPrice": 50 }
  ],
  "totalAmount": 250,
  "productItemsCount": 3,
  "status": "Opened",
  "openedAt": "2025-12-02T10:00:00Z"
}
```

#### 2. ShoppingCartShortInfo (Summary Only)

**Endpoint**: `GET /clients/{clientId}/shopping-carts/current/summary`

**Contains**:
- Total amount
- Product count

**Use Case**: Display cart badge/counter in UI

**Example Response**:
```json
{
  "totalAmount": 250,
  "productItemsCount": 3
}
```

### Projection Lifecycle

Both projections follow the same lifecycle:

1. **Created** when first product added
2. **Updated** on each add/remove
3. **Deleted** when cart is confirmed/cancelled

## Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose (for emulators)

### Installation

```bash
# Install dependencies
npm install
```

### Running with Docker (Recommended)

Start everything (emulators + application):

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Stop and clear all data (volumes)
docker-compose down -v
```

Access points:

- **API**: <http://localhost:3000>
- **Firebase Emulator UI**: <http://localhost:4000> (Firestore + Realtime DB)
- **PubSub UI**: <http://localhost:8086> (PubSub topics and subscriptions)

### Running Locally (Development)

Start emulators only, run app locally:

```bash
# Terminal 1: Start only Firebase emulators
docker-compose up -d firebase

# Terminal 2: Run app locally with auto-reload
FIRESTORE_PROJECT_ID=demo-project \
FIRESTORE_EMULATOR_HOST=localhost:8080 \
FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000 \
PUBSUB_PROJECT_ID=demo-project \
PUBSUB_EMULATOR_HOST=localhost:8085 \
PORT=3000 \
npm run dev
```

### Firebase Emulator UI

Visit http://localhost:4000 to:

- View Firestore events (namespace: `demo-project`)
- Inspect Realtime DB projections
- Debug data in real-time

**Important**: Select the `demo-project` namespace in the Realtime Database tab to see your data.

### PubSub Emulator UI

Visit <http://localhost:8086> to:

- View PubSub topics (e.g., `shopping-cart-evt-ShoppingCartConfirmed`)
- Monitor active subscriptions
- See message flow in real-time
- Debug event delivery

### Clearing Emulator Data

```bash
# Clear Realtime Database only (via API)
curl -X DELETE "http://localhost:9000/.json?ns=demo-project"

# Clear Firestore only
curl -X DELETE "http://localhost:8080/emulator/v1/projects/demo-project/databases/(default)/documents"

# Clear everything (restart with clean volumes)
docker-compose down -v && docker-compose up -d
```

## Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit        # Business logic tests
npm run test:int         # Integration tests (with emulators)
npm run test:e2e         # End-to-end tests

# Watch mode
npm run test:watch
```

## API Endpoints

### Commands (Write Operations)

#### Add Product to Cart
```http
POST /clients/{clientId}/shopping-carts/current/product-items
Authorization: Bearer token-writer
Content-Type: application/json

{
  "productId": "product-1",
  "quantity": 2
}
```

#### Remove Product from Cart
```http
DELETE /clients/{clientId}/shopping-carts/current/product-items?productId=product-1&quantity=1&unitPrice=100
Authorization: Bearer token-writer
```

#### Confirm Cart
```http
POST /clients/{clientId}/shopping-carts/current/confirm
Authorization: Bearer token-writer
```

#### Cancel Cart
```http
DELETE /clients/{clientId}/shopping-carts/current
Authorization: Bearer token-writer
```

### Queries (Read Operations)

#### Get Cart Details (Full)
```http
GET /clients/{clientId}/shopping-carts/current
Authorization: Bearer token-admin
```

Returns complete cart information from **Details projection**.

#### Get Cart Summary
```http
GET /clients/{clientId}/shopping-carts/current/summary
Authorization: Bearer token-admin
```

Returns only totals from **ShortInfo projection**.

## Manual Testing

Use the included `.http` file with [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) VS Code extension:

1. Open `/.http`
2. Click "Send Request" above each request
3. View responses inline

Or use curl:

```bash
# Add product
curl -X POST http://localhost:3000/clients/test-client/shopping-carts/current/product-items \
  -H "Authorization: Bearer token-writer" \
  -H "Content-Type: application/json" \
  -d '{"productId":"product-1","quantity":2}'

# Get details
curl http://localhost:3000/clients/test-client/shopping-carts/current \
  -H "Authorization: Bearer token-admin"

# Get summary
curl http://localhost:3000/clients/test-client/shopping-carts/current/summary \
  -H "Authorization: Bearer token-admin"
```

## Project Structure

```
examples/shopping-cart/
├── src/
│   ├── index.ts                           # App initialization + wiring
│   ├── handlers/
│   │   └── shoppingCarts.ts               # HTTP handlers (POST/DELETE/GET)
│   └── shoppingCarts/
│       ├── businessLogic.ts               # Commands & business rules
│       ├── shoppingCart.ts                # Events & aggregate evolve
│       ├── getDetails/
│       │   └── index.ts                   # Details projection + query
│       └── getShortInfo/
│           └── index.ts                   # ShortInfo projection + query
├── test/
│   ├── businessLogic.unit.spec.ts         # Business logic tests
│   ├── handlers.int.spec.ts               # Integration tests
│   └── handlers.e2e.spec.ts               # E2E tests
├── docker-compose.yml                      # Firebase emulators
├── firebase.json                           # Emulator config (Firestore + RTDB)
├── openapi.yml                             # OpenAPI spec with GET endpoints
└── .http                                   # Manual test requests
```

## Key Implementation Details

### Wiring Projections

In [src/index.ts](src/index.ts:50-57):

```typescript
const eventStore = wireRealtimeDBProjections({
  eventStore: baseEventStore,
  database,
  projections: [
    shoppingCartDetailsProjection,
    shoppingCartShortInfoProjection,
  ],
});
```

### Projection Definitions

**Details Projection** ([src/shoppingCarts/getDetails/index.ts](src/shoppingCarts/getDetails/index.ts)):

```typescript
export const shoppingCartDetailsProjection = realtimeDBInlineProjection({
  name: 'shoppingCartDetails',
  evolve: (state, event) => {
    // Build complete cart details
  },
  canHandle: ['ProductItemAdded', 'ProductItemRemoved', 'ShoppingCartConfirmed', 'ShoppingCartCancelled'],
});
```

**ShortInfo Projection** ([src/shoppingCarts/getShortInfo/index.ts](src/shoppingCarts/getShortInfo/index.ts)):

```typescript
export const shoppingCartShortInfoProjection = realtimeDBInlineProjection({
  name: 'shoppingCartShortInfo',
  evolve: (state, event) => {
    // Return null on confirm/cancel to delete projection
    if (event.type === 'ShoppingCartConfirmed' || event.type === 'ShoppingCartCancelled') {
      return null;
    }
    // Otherwise update totals
  },
  initialState: () => ({ totalAmount: 0, productItemsCount: 0 }),
  canHandle: ['ProductItemAdded', 'ProductItemRemoved', 'ShoppingCartConfirmed', 'ShoppingCartCancelled'],
});
```

### Query Functions

```typescript
export const getDetailsById = async (
  database: Database,
  shoppingCartId: ShoppingCartId,
): Promise<ShoppingCartDetails | null> => {
  const snapshot = await database
    .ref(`projections/shoppingCartDetails/${shoppingCartId}`)
    .once('value');
  return snapshot.val() ?? null;
};
```

## Docker Setup

The `docker-compose.yml` runs:

1. **Firebase Emulator Container**: Firestore + Realtime DB + UI
2. **Application Container**: Express.js API

```bash
# Start everything
docker-compose up

# Stop
docker-compose down

# Rebuild after code changes
docker-compose up --build
```

## Authentication

The example uses simple bearer token authentication:

- `token-writer`: Can write (POST/DELETE)
- `token-admin`: Can read and write (GET/POST/DELETE)

In production, replace with proper JWT validation.

## Environment Variables

Create `.env` from `.env.example`:

```bash
# Firestore
FIRESTORE_PROJECT_ID=demo-project
FIRESTORE_EMULATOR_HOST=localhost:8080

# Realtime Database
FIREBASE_DATABASE_EMULATOR_HOST=localhost:9000

# Application
PORT=3000
NODE_ENV=development
```

## Learn More

- [Parent Package README](../../README.md) - Full API reference
- [Emmett Documentation](https://event-driven-io.github.io/emmett/)
- [MongoDB Example](https://github.com/event-driven-io/emmett/tree/main/samples/webApi/expressjs-with-mongodb) - Similar pattern with MongoDB

## Troubleshooting

### Emulator Connection Issues

If you see connection errors:

```bash
# Check if emulators are running
docker ps

# View emulator logs
docker-compose logs firebase

# Restart emulators
docker-compose restart firebase
```

### Port Already in Use

Change ports in `.env` and `docker-compose.yml` if 3000, 4000, 8080, or 9000 are already in use.

### Projection Not Updating

1. Check Firebase UI (http://localhost:4000)
2. Verify Firestore events are being created
3. Check Realtime DB for projection data
4. Review application logs for errors

---

Happy coding with Emmett + Firebase! 🚀
