import { IllegalStateError } from '@event-driven-io/emmett';
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';
import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';
import { wireRealtimeDBProjections } from '@emmett-community/emmett-google-realtime-db';
import {
  createOpenApiValidatorOptions,
  getApplication,
  startAPI,
  type ErrorToProblemDetailsMapping,
  type ImportedHandlerModules,
  type SecurityHandlers,
} from '@emmett-community/emmett-expressjs-with-openapi';
import type { Application } from 'express';
import admin from 'firebase-admin';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShoppingCartError } from './shoppingCarts/businessLogic';
import type { ShoppingCartConfirmed } from './shoppingCarts/shoppingCart';
import {
  shoppingCartDetailsProjection,
  shoppingCartShortInfoProjection,
} from './shoppingCarts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const FIRESTORE_PROJECT_ID = process.env.FIRESTORE_PROJECT_ID || 'demo-project';
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const PUBSUB_PROJECT_ID = process.env.PUBSUB_PROJECT_ID || 'demo-project';
const PUBSUB_EMULATOR_HOST = process.env.PUBSUB_EMULATOR_HOST;

// Initialize Firebase Admin
// Always provide databaseURL with namespace to prevent "fake-server" creation
const databaseURL = DATABASE_EMULATOR_HOST
  ? `http://${DATABASE_EMULATOR_HOST}?ns=${FIRESTORE_PROJECT_ID}`
  : `https://${FIRESTORE_PROJECT_ID}-default-rtdb.firebaseio.com`;

admin.initializeApp({
  projectId: FIRESTORE_PROJECT_ID,
  databaseURL,
});

// Get Firestore and Realtime Database instances
const firestore = admin.firestore();
const database = admin.database();

// Configure emulators if needed
if (FIRESTORE_EMULATOR_HOST) {
  firestore.settings({
    host: FIRESTORE_EMULATOR_HOST,
    ssl: false,
  });
}

if (DATABASE_EMULATOR_HOST) {
  const [host, port] = DATABASE_EMULATOR_HOST.split(':');
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = `${host}:${port}`;
}

// Initialize PubSub client
const pubsub = new PubSub({
  projectId: PUBSUB_PROJECT_ID,
});

// Configure for emulator if PUBSUB_EMULATOR_HOST is set
if (PUBSUB_EMULATOR_HOST) {
  console.log(`Using PubSub emulator at ${PUBSUB_EMULATOR_HOST}`);
}

// Create Firestore event store
const baseEventStore = getFirestoreEventStore(firestore);

// Wire Realtime DB projections to the event store
// @ts-ignore - Type compatibility issue between Firestore and generic EventStore
const eventStore = wireRealtimeDBProjections<typeof baseEventStore>({
  eventStore: baseEventStore,
  database,
  projections: [
    shoppingCartDetailsProjection,
    shoppingCartShortInfoProjection,
  ],
});

const messageBus = getPubSubMessageBus({
  pubsub,
  useEmulator: !!PUBSUB_EMULATOR_HOST,
  topicPrefix: 'shopping-cart',
});

const getUnitPrice = (_productId: string) => Promise.resolve(100);
const getCurrentTime = () => new Date();

// Temporarily disabled to view messages in PubSub UI
// messageBus.subscribe((event: ShoppingCartConfirmed) => {
//   if (event.type === 'ShoppingCartConfirmed') {
//     console.info(
//       `Shopping cart confirmed: ${event.data.shoppingCartId} at ${event.data.confirmedAt.toISOString()}`,
//     );
//   }
// }, 'ShoppingCartConfirmed');

const users = new Map([
  ['token-writer', { id: 'writer', scopes: ['cart:write'] }],
  [
    'token-admin',
    { id: 'admin', scopes: ['cart:write', 'cart:read', 'admin'] },
  ],
]);

const securityHandlers: SecurityHandlers = {
  bearerAuth: async (req, scopes) => {
    const authHeader = req.headers.authorization as string | undefined;

    if (!authHeader?.startsWith('Bearer ')) return false;

    const token = authHeader.substring('Bearer '.length);
    const user = users.get(token);
    if (!user) return false;

    req.user = user;

    if (scopes.length === 0) return true;

    return scopes.every((scope) => user.scopes.includes(scope));
  },
};

const openApiFilePath = path.join(__dirname, '../openapi.yml');

const errorStatusMap: Record<string, number> = {
  [ShoppingCartError.CART_CLOSED]: 403,
  [ShoppingCartError.CART_NOT_OPENED]: 403,
  [ShoppingCartError.INSUFFICIENT_QUANTITY]: 403,
  [ShoppingCartError.CART_ALREADY_EXISTS]: 409,
  [ShoppingCartError.CART_EMPTY]: 400,
};

const mapErrorToProblemDetails: ErrorToProblemDetailsMapping = (error) => {
  if (!(error instanceof IllegalStateError)) {
    return undefined; // Use default error handling
  }

  const statusCode = errorStatusMap[error.message] ?? 500;

  return {
    status: statusCode,
    title:
      statusCode === 403
        ? 'Forbidden'
        : statusCode === 409
          ? 'Conflict'
          : 'Bad Request',
    detail: error.message,
    type: 'about:blank',
  } as any;
};

export const app: Application = await getApplication({
  mapError: mapErrorToProblemDetails,
  openApiValidator: createOpenApiValidatorOptions(openApiFilePath, {
    validateRequests: true,
    validateResponses: process.env.NODE_ENV !== 'production',
    validateFormats: 'fast',
    serveSpec: '/api-docs/openapi.yml',
    validateSecurity: { handlers: securityHandlers },
    operationHandlers: path.join(__dirname, './handlers'),
    initializeHandlers: async (handlers?: ImportedHandlerModules) => {
      // Framework auto-imports handler modules!
      handlers!.shoppingCarts.initializeHandlers(
        eventStore,
        database,
        messageBus,
        getUnitPrice,
        getCurrentTime,
      );
    },
  }),
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);

  // Start message bus before starting API (in producer-only mode - no subscriptions)
  await messageBus.start();
  console.log('✅ Message bus started in producer-only mode (not consuming messages)');

  startAPI(app, { port });
  console.log(`🚀 Shopping Cart API listening on http://localhost:${port}`);
  console.log('OpenAPI doc available at /api-docs/openapi.yml');
  console.log(
    `Firebase Emulator UI: http://localhost:4000 (Firestore + Realtime DB)`,
  );
  console.log(`PubSub UI: http://localhost:8086`);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await messageBus.close();
  console.log('✅ Message bus closed');
  await firestore.terminate();
  await admin.app().delete();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down gracefully...');
  await messageBus.close();
  console.log('✅ Message bus closed');
  await firestore.terminate();
  await admin.app().delete();
  process.exit(0);
});
