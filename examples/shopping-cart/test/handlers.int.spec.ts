import { Firestore } from '@google-cloud/firestore';
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';
import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';
import { wireRealtimeDBProjections } from '@emmett-community/emmett-google-realtime-db';
import {
  ApiSpecification,
  createOpenApiValidatorOptions,
  existingStream,
  expectError,
  expectNewEvents,
  expectResponse,
  getApplication,
  type ImportedHandlerModules,
} from '@emmett-community/emmett-expressjs-with-openapi';
import admin from 'firebase-admin';
import type { Database } from 'firebase-admin/database';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  type PricedProductItem,
  type ShoppingCartEvent,
} from '../src/shoppingCarts/shoppingCart';
import { shoppingCartDetailsProjection } from '../src/shoppingCarts/getDetails';
import { shoppingCartShortInfoProjection } from '../src/shoppingCarts/getShortInfo';
import assert from 'node:assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const authHeader = ['Authorization', 'Bearer token-writer'] as const;
const getUnitPrice = (_productId: string) => Promise.resolve(100);

// Helper to wait for PubSub message delivery
const waitForMessageDelivery = () =>
  new Promise((resolve) => setTimeout(resolve, 100));

void describe('ShoppingCart integration (OpenAPI)', () => {
  let clientId: string;
  let shoppingCartId: string;

  const pubsub = new PubSub({
    projectId: process.env.PUBSUB_PROJECT_ID || 'demo-project',
  });

  const messageBus = getPubSubMessageBus({
    pubsub,
    useEmulator: !!process.env.PUBSUB_EMULATOR_HOST,
    topicPrefix: 'shopping-cart-test',
    closePubSubClient: false,
  });

  const oldTime = new Date();
  const now = new Date();

  beforeEach(() => {
    clientId = randomUUID();
    shoppingCartId = `shopping_cart:${clientId}:current`;
  });

  after(async () => {
    await firestore.terminate();
    await admin.app().delete();
  });

  void describe('When empty', () => {
    void it('adds product item', async () => {
      await given()
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .set(...authHeader)
            .send(productItem),
        )
        .then([
          expectNewEvents(shoppingCartId, [
            {
              type: 'ProductItemAddedToShoppingCart',
              data: {
                shoppingCartId,
                clientId,
                productItem,
                addedAt: now,
              },
              metadata: { clientId },
            },
          ]),
        ]);

      // Wait for PubSub message delivery
      await waitForMessageDelivery();

      // Verify RTDB projection created
      const detailsSnapshot = await database
        .ref(`projections/shoppingCartDetails/${shoppingCartId}`)
        .once('value');
      const details = detailsSnapshot.val();
      assert.ok(details);
      assert.strictEqual(details.id, shoppingCartId);
      assert.strictEqual(details.clientId, clientId);
      assert.strictEqual(details.status, 'Opened');
      assert.strictEqual(details.productItems.length, 1);
      assert.strictEqual(details.productItems[0].productId, productItem.productId);
      assert.strictEqual(details.productItems[0].quantity, productItem.quantity);
      assert.strictEqual(details.productItemsCount, productItem.quantity);
      assert.strictEqual(details.totalAmount, productItem.unitPrice! * productItem.quantity);

      const shortInfoSnapshot = await database
        .ref(`projections/shoppingCartShortInfo/${shoppingCartId}`)
        .once('value');
      const shortInfo = shortInfoSnapshot.val();
      assert.ok(shortInfo);
      assert.strictEqual(shortInfo.productItemsCount, productItem.quantity);
      assert.strictEqual(shortInfo.totalAmount, productItem.unitPrice! * productItem.quantity);
    });

    void it('rejects missing auth header', () => {
      return given()
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .send(productItem),
        )
        .then([
          expectError(401, {
            title: 'Unauthorized',
            status: 401,
          }),
        ]);
    });
  });

  void describe('When opened with product item', () => {
    void it('confirms cart', async () => {
      await given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem,
              addedAt: oldTime,
            },
            metadata: { clientId },
          },
        ]),
      )
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/confirm`)
            .set(...authHeader),
        )
        .then([
          expectResponse(204),
          expectNewEvents(shoppingCartId, [
            {
              type: 'ShoppingCartConfirmed',
              data: {
                shoppingCartId,
                confirmedAt: now,
              },
              metadata: { clientId },
            },
          ]),
        ]);

      // Note: RTDB projections are not created for existingStream events
      // They're only created when events are appended via wireRealtimeDBProjections
      // So we cannot verify RTDB state here - only event appending is tested
    });

    void it('removes product item', async () => {
      await given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem,
              addedAt: oldTime,
            },
            metadata: { clientId },
          },
        ]),
      )
        .when((request) =>
          request
            .delete(`/clients/${clientId}/shopping-carts/current/product-items`)
            .set(...authHeader)
            .query({
              productId: productItem.productId,
              quantity: productItem.quantity,
              unitPrice: productItem.unitPrice,
            }),
        )
        .then([
          expectResponse(204),
          expectNewEvents(shoppingCartId, [
            {
              type: 'ProductItemRemovedFromShoppingCart',
              data: {
                shoppingCartId,
                productItem,
                removedAt: now,
              },
              metadata: { clientId },
            },
          ]),
        ]);

      // Note: RTDB projections are not created for existingStream events
      // They're only created when events are appended via wireRealtimeDBProjections
      // So we cannot verify RTDB state here - only event appending is tested
    });

    void it('cancels cart', async () => {
      await given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem,
              addedAt: oldTime,
            },
            metadata: { clientId },
          },
        ]),
      )
        .when((request) =>
          request
            .delete(`/clients/${clientId}/shopping-carts/current`)
            .set(...authHeader),
        )
        .then([
          expectResponse(204),
          expectNewEvents(shoppingCartId, [
            {
              type: 'ShoppingCartCancelled',
              data: {
                shoppingCartId,
                cancelledAt: now,
              },
              metadata: { clientId },
            },
          ]),
        ]);

      // Note: RTDB projections are not created for existingStream events
      // They're only created when events are appended via wireRealtimeDBProjections
      // So we cannot verify RTDB state here - only event appending is tested
    });
  });

  void describe('When confirmed', () => {
    void it('blocks adding items', () => {
      return given(
        existingStream(shoppingCartId, [
          {
            type: 'ProductItemAddedToShoppingCart',
            data: {
              shoppingCartId,
              clientId,
              productItem,
              addedAt: oldTime,
            },
            metadata: { clientId },
          },
          {
            type: 'ShoppingCartConfirmed',
            data: { shoppingCartId, confirmedAt: oldTime },
            metadata: { clientId },
          },
        ]),
      )
        .when((request) =>
          request
            .post(`/clients/${clientId}/shopping-carts/current/product-items`)
            .set(...authHeader)
            .send(productItem),
        )
        .then(
          expectError(403, {
            detail: 'CART_CLOSED',
            status: 403,
            title: 'Forbidden',
            type: 'about:blank',
          }),
        );
    });
  });

  const firestore = new Firestore({
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

  const database: Database = admin.database();

  const given = ApiSpecification.for<ShoppingCartEvent>(
    () => {
      const baseEventStore = getFirestoreEventStore(firestore);
      return wireRealtimeDBProjections({
        eventStore: baseEventStore,
        database,
        projections: [
          shoppingCartDetailsProjection,
          shoppingCartShortInfoProjection,
        ],
      });
    },
    (eventStore) => {
      return getApplication({
        openApiValidator: createOpenApiValidatorOptions(
          path.join(__dirname, '../openapi.yml'),
          {
            validateRequests: true,
            validateSecurity: true,
            validateResponses: false,
            operationHandlers: path.join(__dirname, '../src/handlers'),
            initializeHandlers: async (handlers?: ImportedHandlerModules) => {
              // Ensure message bus is started before handlers use it
              if (!messageBus.isStarted()) {
                await messageBus.start();
              }

              handlers!.shoppingCarts.initializeHandlers(
                eventStore,
                database,
                messageBus,
                getUnitPrice,
                () => now
              );
            },
          },
        ),
      });
    },
  );

  const getRandomProduct = (): PricedProductItem => {
    return {
      productId: randomUUID(),
      quantity: Math.floor(Math.random() * 10) + 1,
      unitPrice: 100,
    };
  };

  const productItem = getRandomProduct();
});
