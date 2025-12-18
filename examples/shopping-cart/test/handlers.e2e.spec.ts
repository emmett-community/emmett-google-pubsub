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

void describe('ShoppingCart e2e (OpenAPI)', () => {
  let clientId: string;
  let shoppingCartId: string;
  let given: ApiE2ESpecification;
  let database: Database;
  let firestore: Firestore;

  before(async () => {
    firestore = new Firestore({
      projectId: 'demo-project',
      host: process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080',
      ssl: false,
      customHeaders: {
        Authorization: 'Bearer owner',
      },
    });

    // Initialize Firebase Admin SDK for Realtime Database
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: 'demo-project',
        databaseURL: `http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST || 'localhost:9000'}?ns=demo-project`,
      });
    }

    database = admin.database();

    const baseEventStore = getFirestoreEventStore(firestore);
    const eventStore = wireRealtimeDBProjections({
      eventStore: baseEventStore,
      database,
      projections: [
        shoppingCartDetailsProjection,
        shoppingCartShortInfoProjection,
      ],
    });

    const pubsub = new PubSub({
      projectId: process.env.PUBSUB_PROJECT_ID || 'demo-project',
    });

    const messageBus = getPubSubMessageBus({
      pubsub,
      useEmulator: !!process.env.PUBSUB_EMULATOR_HOST,
      topicPrefix: 'shopping-cart-e2e',
      closePubSubClient: false,
    });

    // Start message bus for E2E tests
    await messageBus.start();

    const getUnitPrice = (_productId: string) => Promise.resolve(100);
    const getCurrentTime = () => new Date();

    given = ApiE2ESpecification.for(
      () => eventStore,
      () =>
        getApplication({
          openApiValidator: createOpenApiValidatorOptions(
            path.join(__dirname, '../openapi.yml'),
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
    await firestore.terminate();
    await admin.app().delete();
  });

  beforeEach(async () => {
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
    // Clear Realtime DB
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
      );

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
