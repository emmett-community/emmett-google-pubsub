import { Firestore } from '@google-cloud/firestore';
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';
import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';
import { wireRealtimeDBProjections } from '@emmett-community/emmett-google-realtime-db';
import {
  ApiE2ESpecification,
  createOpenApiValidatorOptions,
  expectResponse,
  getApplication,
  type ImportedHandlerModules,
  type TestRequest,
} from '@emmett-community/emmett-expressjs-with-openapi';
import admin from 'firebase-admin';
import type { Database } from 'firebase-admin/database';
import { GenericContainer, Wait } from 'testcontainers';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ProductItem } from '../src/shoppingCarts/shoppingCart';
import { shoppingCartDetailsProjection } from '../src/shoppingCarts/getDetails';
import { shoppingCartShortInfoProjection } from '../src/shoppingCarts/getShortInfo';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to wait for PubSub message delivery
const waitForMessageDelivery = () =>
  new Promise((resolve) => setTimeout(resolve, 100));

const projectId = 'demo-project';

let emulator: import('testcontainers').StartedTestContainer | null = null;
let emulatorHost = '';
let firestorePort = 0;
let databasePort = 0;
let pubsubPort = 0;

const emulatorUrl = () => `http://${emulatorHost}:${firestorePort}`;

const startEmulator = async () => {
  const container = await new GenericContainer(
    'myfstartup/firebase-emulator-suite:15',
  )
    .withPlatform('linux/amd64')
    .withExposedPorts(4000, 8080, 9000, 8085)
    .withBindMounts([
      {
        source: path.join(
          process.cwd(),
          'test',
          'support',
          'firebase',
          'firebase.json',
        ),
        target: '/app/firebase.json',
        mode: 'ro' as const,
      },
      {
        source: path.join(
          process.cwd(),
          'test',
          'support',
          'firebase',
          '.firebaserc',
        ),
        target: '/app/.firebaserc',
        mode: 'ro' as const,
      },
    ])
    .withEnvironment({ PROJECT_ID: projectId })
    .withWaitStrategy(Wait.forHttp('/', 4000).withStartupTimeout(120000))
    .start();

  emulatorHost = container.getHost();
  firestorePort = container.getMappedPort(8080);
  databasePort = container.getMappedPort(9000);
  pubsubPort = container.getMappedPort(8085);

  process.env.FIRESTORE_EMULATOR_HOST = `${emulatorHost}:${firestorePort}`;
  process.env.FIRESTORE_PROJECT_ID = projectId;
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = `${emulatorHost}:${databasePort}`;
  process.env.PUBSUB_EMULATOR_HOST = `${emulatorHost}:${pubsubPort}`;
  process.env.PUBSUB_PROJECT_ID = projectId;

  return container;
};

const resetFirestore = async () => {
  const res = await fetch(
    `${emulatorUrl()}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );

  if (!res.ok) {
    throw new Error(`Failed to reset Firestore emulator: ${res.status} ${res.statusText}`);
  }
};

void describe('ShoppingCart e2e (OpenAPI)', () => {
  let clientId: string;
  let shoppingCartId: string;
  let given: ApiE2ESpecification;
  let database: Database;
  let firestore: Firestore;
  let app: admin.app.App;
  let messageBus: ReturnType<typeof getPubSubMessageBus>;

  before(async () => {
    emulator = await startEmulator();

    firestore = new Firestore({
      projectId,
      host: `${emulatorHost}:${firestorePort}`,
      ssl: false,
      customHeaders: {
        Authorization: 'Bearer owner',
      },
    });

    app = admin.initializeApp(
      {
        projectId,
        databaseURL: `http://${emulatorHost}:${databasePort}?ns=${projectId}`,
      },
      `shopping-cart-e2e-${Date.now()}`,
    );
    database = admin.database(app);

    const baseEventStore = getFirestoreEventStore(firestore);
    // @ts-ignore - Type compatibility issue between Firestore and generic EventStore
    const eventStore = wireRealtimeDBProjections<typeof baseEventStore>({
      eventStore: baseEventStore,
      database,
      projections: [
        shoppingCartDetailsProjection,
        shoppingCartShortInfoProjection,
      ],
    });

    const pubsub = new PubSub({
      projectId,
      apiEndpoint: `${emulatorHost}:${pubsubPort}`,
    });

    messageBus = getPubSubMessageBus({
      pubsub,
      useEmulator: true,
      topicPrefix: 'shopping-cart-e2e',
      closePubSubClient: false,
    });

    // Start message bus for E2E tests
    await messageBus.start();

    const getUnitPrice = (_productId: string) => Promise.resolve(100);
    const getCurrentTime = () => new Date();

    given = ApiE2ESpecification.for(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => eventStore as any,
      () =>
        getApplication({
          openApiValidator: createOpenApiValidatorOptions(
            path.join(__dirname, '../src/openapi.yml'),
            {
              validateRequests: true,
              validateSecurity: true,
              validateResponses: false,
              operationHandlers: path.join(__dirname, '../src/handlers'),
              initializeHandlers: async (handlers?: ImportedHandlerModules) => {
                handlers!.shoppingCarts.initializeHandlers(
                  eventStore,
                  database,
                  messageBus,
                  getUnitPrice,
                  getCurrentTime
                );
              },
            },
          ),
        }),
    );
  });

  after(async () => {
    await messageBus.close();
    await firestore.terminate();
    await app.delete();
    if (emulator) {
      await emulator.stop();
    }
  });

  beforeEach(async () => {
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
    await resetFirestore();
    await database.ref().remove();
  });

  const auth = (request: ReturnType<TestRequest>) =>
    request.set('Authorization', 'Bearer token-writer');

  void describe('When empty', () => {
    void it('adds product item', () => {
      return given()
        .when((request) =>
          auth(
            request
              .post(`/clients/${clientId}/shopping-carts/current/product-items`)
              .send(productItem),
          ),
        )
        .then([expectResponse(204)]);
    });

    void it('rejects invalid payload', () => {
      return given()
        .when((request) =>
          auth(
            request
              .post(`/clients/${clientId}/shopping-carts/current/product-items`)
              .send({ productId: 'test' }),
          ),
        )
        .then([expectResponse(400)]);
    });
  });

  void describe('When open', () => {
    const openedShoppingCart: TestRequest = (request) =>
      auth(
        request
          .post(`/clients/${clientId}/shopping-carts/current/product-items`)
          .send(productItem),
      );

    void it('confirms cart', () => {
      return given(openedShoppingCart)
        .when((request) =>
          auth(
            request.post(
              `/clients/${clientId}/shopping-carts/current/confirm`,
            ),
          ),
        )
        .then([expectResponse(204)]);
    });

    void it('cancels cart', () => {
      return given(openedShoppingCart)
        .when((request) =>
          auth(
            request.delete(`/clients/${clientId}/shopping-carts/current`),
          ),
        )
        .then([expectResponse(204)]);
    });

    void it('removes product', () => {
      return given(openedShoppingCart)
        .when((request) =>
          auth(
            request
              .delete(
                `/clients/${clientId}/shopping-carts/current/product-items`,
              )
              .query({
                productId: productItem.productId,
                quantity: productItem.quantity,
                unitPrice: 100,
              }),
          ),
        )
        .then([expectResponse(204)]);
    });

    // NEW: Test reading projections from RTDB
    void it('gets cart details from projection', () => {
      return given(openedShoppingCart)
        .when((request) =>
          request
            .get(`/clients/${clientId}/shopping-carts/current`)
            .set('Authorization', 'Bearer token-admin'),
        )
        .then([expectResponse(200)]);
    });

    void it('gets cart summary from projection', () => {
      return given(openedShoppingCart)
        .when((request) =>
          request
            .get(`/clients/${clientId}/shopping-carts/current/summary`)
            .set('Authorization', 'Bearer token-admin'),
        )
        .then([expectResponse(200)]);
    });
  });

  void describe('After confirmed', () => {
    const confirmedShoppingCart: TestRequest = (request) =>
      auth(
        request
          .post(`/clients/${clientId}/shopping-carts/current/product-items`)
          .send(productItem),
      ).then(() =>
        auth(
          request.post(
            `/clients/${clientId}/shopping-carts/current/confirm`,
          ),
        ),
      ) as any;

    void it('returns 404 when getting details (projection filtered)', async () => {
      await given(confirmedShoppingCart);

      // Wait for PubSub message delivery and projection update
      await waitForMessageDelivery();

      return given()
        .when((request) =>
          request
            .get(`/clients/${clientId}/shopping-carts/current`)
            .set('Authorization', 'Bearer token-admin'),
        )
        .then([expectResponse(404)]);
    });

    void it('returns 404 when getting summary (projection deleted)', async () => {
      await given(confirmedShoppingCart);

      // Wait for PubSub message delivery and projection update
      await waitForMessageDelivery();

      return given()
        .when((request) =>
          request
            .get(`/clients/${clientId}/shopping-carts/current/summary`)
            .set('Authorization', 'Bearer token-admin'),
        )
        .then([expectResponse(404)]);
    });
  });

  void describe('OpenAPI/ security errors', () => {
    void it('requires auth', () => {
      return given()
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .send(productItem),
        )
        .then([expectResponse(401)]);
    });

    void it('validates query parameters', () => {
      return given()
        .when((request) =>
          auth(
            request
              .delete(
                `/clients/${clientId}/shopping-carts/current/product-items`,
              )
              .query({ productId: 'test' }),
          ),
        )
        .then([expectResponse(400)]);
    });
  });

  const getRandomProduct = (): ProductItem => {
    return {
      productId: randomUUID(),
      quantity: Math.floor(Math.random() * 10) + 1,
    };
  };

  const productItem = getRandomProduct();
});
