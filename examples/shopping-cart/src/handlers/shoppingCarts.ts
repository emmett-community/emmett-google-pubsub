/**
 * Operation handlers invoked by express-openapi-validator.
 * Function names must match the OpenAPI operationId.
 */

import {
  CommandHandler,
  assertNotEmptyString,
  assertPositiveNumber,
  type EventStore,
  type EventsPublisher,
} from '@event-driven-io/emmett';
import { NoContent, NotFound, OK, on } from '@emmett-community/emmett-expressjs-with-openapi';
import type { Request } from 'express';
import type { Database } from 'firebase-admin/database';
import {
  addProductItem as addProductItemCommand,
  cancel,
  confirm,
  createAddProductItemCommand,
  createCancelShoppingCartCommand,
  createConfirmShoppingCartCommand,
  createRemoveProductItemCommand,
  removeProductItem as removeProductItemCommand,
} from '../shoppingCarts/businessLogic';
import { evolve, initialState, ShoppingCartId } from '../shoppingCarts/shoppingCart';
import { getDetailsById } from '../shoppingCarts/getDetails';
import { getShortInfoById } from '../shoppingCarts/getShortInfo';

const handle = CommandHandler({ evolve, initialState });

/////////////////////////////////////////
////////// Module-level Dependencies (private)
/////////////////////////////////////////

let eventStore: EventStore;
let database: Database;
let messageBus: EventsPublisher;
let getUnitPrice: (_productId: string) => Promise<number>;
let getCurrentTime: () => Date;

/////////////////////////////////////////
////////// Initialization Function
/////////////////////////////////////////

export const initializeHandlers = (
  store: EventStore,
  db: Database,
  bus: EventsPublisher,
  priceGetter: (_productId: string) => Promise<number>,
  timeGetter: () => Date,
) => {
  eventStore = store;
  database = db;
  messageBus = bus;
  getUnitPrice = priceGetter;
  getCurrentTime = timeGetter;
};

/////////////////////////////////////////
////////// Request Types
/////////////////////////////////////////

type AddProductItemRequest = Request<
  Partial<{ clientId: string }>,
  unknown,
  Partial<{ productId: string; quantity: number }>
>;

type RemoveProductItemRequest = Request<
  Partial<{ clientId: string }>,
  unknown,
  unknown,
  Partial<{ productId: string; quantity: string; unitPrice: string }>
>;

type ConfirmShoppingCartRequest = Request<
  Partial<{ clientId: string }>,
  unknown,
  unknown
>;

type CancelShoppingCartRequest = Request<
  Partial<{ clientId: string }>,
  unknown,
  unknown
>;

type GetShoppingCartRequest = Request<
  Partial<{ clientId: string }>,
  unknown,
  unknown
>;

type GetShoppingCartSummaryRequest = Request<
  Partial<{ clientId: string }>,
  unknown,
  unknown
>;

/////////////////////////////////////////
////////// Operation Handlers (exports for express-openapi-validator)
/////////////////////////////////////////

// POST /clients/{clientId}/shopping-carts/current/product-items
export const addProductItem = on(async (request: AddProductItemRequest) => {
  const clientId = assertNotEmptyString(request.params.clientId);
  const productId = assertNotEmptyString(request.body.productId);
  const quantity = assertPositiveNumber(request.body.quantity);
  const unitPrice = await getUnitPrice(productId);

  const command = createAddProductItemCommand(
    clientId,
    { productId, quantity, unitPrice },
    getCurrentTime(),
  );

  await handle(eventStore, command.data.shoppingCartId, (state) =>
    addProductItemCommand(command, state),
  );

  return NoContent();
});

// DELETE /clients/{clientId}/shopping-carts/current/product-items
export const removeProductItem = on(
  async (request: RemoveProductItemRequest) => {
    const clientId = assertNotEmptyString(request.params.clientId);
    const productId = assertNotEmptyString(request.query.productId);
    const quantity = assertPositiveNumber(Number(request.query.quantity));
    const unitPrice = assertPositiveNumber(Number(request.query.unitPrice));

    const command = createRemoveProductItemCommand(
      clientId,
      { productId, quantity, unitPrice },
      getCurrentTime(),
    );

    await handle(eventStore, command.data.shoppingCartId, (state) =>
      removeProductItemCommand(command, state),
    );

    return NoContent();
  },
);

// POST /clients/{clientId}/shopping-carts/current/confirm
export const confirmShoppingCart = on(
  async (request: ConfirmShoppingCartRequest) => {
    const clientId = assertNotEmptyString(request.params.clientId);

    const command = createConfirmShoppingCartCommand(clientId, getCurrentTime());

    const {
      newEvents: [confirmed, ..._rest],
    } = await handle(eventStore, command.data.shoppingCartId, (state) =>
      confirm(command, state),
    );

    await messageBus.publish(confirmed);

    return NoContent();
  },
);

// DELETE /clients/{clientId}/shopping-carts/current
export const cancelShoppingCart = on(
  async (request: CancelShoppingCartRequest) => {
    const clientId = assertNotEmptyString(request.params.clientId);

    const command = createCancelShoppingCartCommand(clientId, getCurrentTime());

    await handle(eventStore, command.data.shoppingCartId, (state) =>
      cancel(command, state),
    );

    return NoContent();
  },
);

// GET /clients/{clientId}/shopping-carts/current (Details projection)
export const getShoppingCart = on(async (request: GetShoppingCartRequest) => {
  const clientId = assertNotEmptyString(request.params.clientId);
  const shoppingCartId = ShoppingCartId(clientId);

  // Query from Realtime DB - Details projection
  const details = await getDetailsById(database, shoppingCartId);

  if (!details || details.status !== 'Opened') {
    return NotFound();
  }

  // Remove internal metadata before returning
  const { _metadata, ...detailsWithoutMetadata } = details as any;

  return OK({ body: detailsWithoutMetadata });
});

// GET /clients/{clientId}/shopping-carts/current/summary (ShortInfo projection)
export const getShoppingCartSummary = on(
  async (request: GetShoppingCartSummaryRequest) => {
    const clientId = assertNotEmptyString(request.params.clientId);
    const shoppingCartId = ShoppingCartId(clientId);

    // Query from Realtime DB - ShortInfo projection
    const shortInfo = await getShortInfoById(database, shoppingCartId);

    if (!shortInfo) {
      return NotFound();
    }

    // Remove internal metadata before returning
    const { _metadata, ...shortInfoWithoutMetadata } = shortInfo as any;

    return OK({ body: shortInfoWithoutMetadata });
  },
);
