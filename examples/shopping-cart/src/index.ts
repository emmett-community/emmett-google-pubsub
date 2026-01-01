// ============================================================
// 1. IMPORTS
// ============================================================
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
import { createLogger } from '@emmett-community/emmett-observability';
import type { Application } from 'express';
import admin from 'firebase-admin';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShoppingCartError } from './shoppingCarts/businessLogic';
import {
  shoppingCartDetailsProjection,
  shoppingCartShortInfoProjection,
} from './shoppingCarts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 2. CONFIGURATION
// ============================================================
const FIRESTORE_PROJECT_ID =
  process.env.FIRESTORE_PROJECT_ID || 'demo-project';
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const PUBSUB_PROJECT_ID = process.env.PUBSUB_PROJECT_ID || 'demo-project';
const PUBSUB_EMULATOR_HOST = process.env.PUBSUB_EMULATOR_HOST;

// ============================================================
// 2.1 LOGGER INITIALIZATION
// ============================================================
const logger = createLogger({
  serviceName: 'shopping-cart',
  environment: process.env.NODE_ENV,
  logLevel: process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error',
});

// ============================================================
// 3. FIREBASE INITIALIZATION
// ============================================================
const databaseURL = DATABASE_EMULATOR_HOST
  ? `http://${DATABASE_EMULATOR_HOST}?ns=${FIRESTORE_PROJECT_ID}`
  : `https://${FIRESTORE_PROJECT_ID}-default-rtdb.firebaseio.com`;

admin.initializeApp({
  projectId: FIRESTORE_PROJECT_ID,
  databaseURL,
});

const firestore = admin.firestore();
const database = admin.database();

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

// ============================================================
// 4. PUBSUB INITIALIZATION
// ============================================================
const pubsub = new PubSub({
  projectId: PUBSUB_PROJECT_ID,
});

if (PUBSUB_EMULATOR_HOST) {
  logger.info({ host: PUBSUB_EMULATOR_HOST }, 'Using PubSub emulator');
}

// ============================================================
// 5. EVENT STORE & MESSAGE BUS SETUP
// ============================================================
const baseEventStore = getFirestoreEventStore(firestore, {
  observability: { logger },
});

// @ts-ignore - Type compatibility issue between Firestore and generic EventStore
const eventStore = wireRealtimeDBProjections<typeof baseEventStore>({
  eventStore: baseEventStore,
  database,
  projections: [
    shoppingCartDetailsProjection,
    shoppingCartShortInfoProjection,
  ],
  observability: { logger },
});

const messageBus = getPubSubMessageBus({
  pubsub,
  useEmulator: !!PUBSUB_EMULATOR_HOST,
  topicPrefix: 'shopping-cart',
  observability: { logger },
});

// Observer subscription for PubSub UI visualization (emulator only)
if (PUBSUB_EMULATOR_HOST) {
  messageBus.subscribe(
    async () => {
      /* noop */
    },
    'ShoppingCartConfirmed',
  );
}

// ============================================================
// 6. SECURITY HANDLERS
// ============================================================
const getUnitPrice = (_productId: string) => Promise.resolve(100);
const getCurrentTime = () => new Date();

const users = new Map([
  ['token-writer', { id: 'writer', scopes: ['cart:write'] }],
  ['token-admin', { id: 'admin', scopes: ['cart:write', 'cart:read', 'admin'] }],
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

// ============================================================
// 7. ERROR MAPPING
// ============================================================
const openApiFilePath = path.join(__dirname, 'openapi.yml');

const errorStatusMap: Record<string, number> = {
  [ShoppingCartError.CART_CLOSED]: 403,
  [ShoppingCartError.CART_NOT_OPENED]: 403,
  [ShoppingCartError.INSUFFICIENT_QUANTITY]: 403,
  [ShoppingCartError.CART_ALREADY_EXISTS]: 409,
  [ShoppingCartError.CART_EMPTY]: 400,
};

const mapErrorToProblemDetails: ErrorToProblemDetailsMapping = (error) => {
  if (!(error instanceof IllegalStateError)) {
    return undefined;
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

// ============================================================
// 8. APPLICATION SETUP
// ============================================================
export const app: Application = await getApplication({
  mapError: mapErrorToProblemDetails,
  observability: { logger },
  openApiValidator: createOpenApiValidatorOptions(openApiFilePath, {
    validateRequests: true,
    validateResponses: process.env.NODE_ENV !== 'production',
    validateFormats: 'fast',
    serveSpec: '/api-docs/openapi.yml',
    validateSecurity: { handlers: securityHandlers },
    operationHandlers: path.join(__dirname, './handlers'),
    initializeHandlers: async (handlers?: ImportedHandlerModules) => {
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

// ============================================================
// 9. STARTUP & SHUTDOWN
// ============================================================
const gracefulShutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully');
  await messageBus.close();
  await firestore.terminate();
  await admin.app().delete();
  process.exit(0);
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);

  await messageBus.start();
  
  startAPI(app, { port });
  logger.info(
    {
      port,
      apiDocsUrl: '/api-docs/openapi.yml',
      firebaseEmulatorUrl: 'http://localhost:4000',
      pubsubEmulatorUrl: 'http://localhost:4001',
    },
    'Shopping Cart API started',
  );
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
