import {
  EmmettError,
  IllegalStateError,
  sum,
  type Command,
  type Decider,
  type DefaultCommandMetadata,
} from '@event-driven-io/emmett';
import {
  evolve,
  initialState,
  ShoppingCartId,
  type PricedProductItem,
  type ProductItemAddedToShoppingCart,
  type ProductItemRemovedFromShoppingCart,
  type ShoppingCart,
  type ShoppingCartCancelled,
  type ShoppingCartConfirmed,
  type ShoppingCartEvent,
} from './shoppingCart';

/////////////////////////////////////////
////////// Error Codes
/////////////////////////////////////////

export enum ShoppingCartError {
  CART_ALREADY_EXISTS = 'CART_ALREADY_EXISTS',
  CART_CLOSED = 'CART_CLOSED',
  CART_NOT_OPENED = 'CART_NOT_OPENED',
  CART_EMPTY = 'CART_EMPTY',
  INSUFFICIENT_QUANTITY = 'INSUFFICIENT_QUANTITY',
}

/////////////////////////////////////////
////////// Commands
/////////////////////////////////////////

export type ShoppingCartCommandMetadata = DefaultCommandMetadata & {
  clientId: string;
};

export type AddProductItemToShoppingCart = Command<
  'AddProductItemToShoppingCart',
  {
    clientId: string;
    shoppingCartId: string;
    productItem: PricedProductItem;
  },
  ShoppingCartCommandMetadata
>;

export type RemoveProductItemFromShoppingCart = Command<
  'RemoveProductItemFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
  },
  ShoppingCartCommandMetadata
>;

export type ConfirmShoppingCart = Command<
  'ConfirmShoppingCart',
  {
    shoppingCartId: string;
  },
  ShoppingCartCommandMetadata
>;

export type CancelShoppingCart = Command<
  'CancelShoppingCart',
  {
    shoppingCartId: string;
  },
  ShoppingCartCommandMetadata
>;

export type ShoppingCartCommand =
  | AddProductItemToShoppingCart
  | RemoveProductItemFromShoppingCart
  | ConfirmShoppingCart
  | CancelShoppingCart;

/////////////////////////////////////////
////////// Command Factories
/////////////////////////////////////////

export const createAddProductItemCommand = (
  clientId: string,
  productItem: PricedProductItem,
  now: Date,
): AddProductItemToShoppingCart => ({
  type: 'AddProductItemToShoppingCart',
  data: {
    shoppingCartId: ShoppingCartId(clientId),
    clientId,
    productItem,
  },
  metadata: { clientId, now },
});

export const createRemoveProductItemCommand = (
  clientId: string,
  productItem: PricedProductItem,
  now: Date,
): RemoveProductItemFromShoppingCart => ({
  type: 'RemoveProductItemFromShoppingCart',
  data: {
    shoppingCartId: ShoppingCartId(clientId),
    productItem,
  },
  metadata: { clientId, now },
});

export const createConfirmShoppingCartCommand = (
  clientId: string,
  now: Date,
): ConfirmShoppingCart => ({
  type: 'ConfirmShoppingCart',
  data: {
    shoppingCartId: ShoppingCartId(clientId),
  },
  metadata: { clientId, now },
});

export const createCancelShoppingCartCommand = (
  clientId: string,
  now: Date,
): CancelShoppingCart => ({
  type: 'CancelShoppingCart',
  data: {
    shoppingCartId: ShoppingCartId(clientId),
  },
  metadata: { clientId, now },
});

/////////////////////////////////////////
////////// Business Logic
/////////////////////////////////////////

export const addProductItem = (
  command: AddProductItemToShoppingCart,
  state: ShoppingCart,
): ProductItemAddedToShoppingCart => {
  if (state.status === 'Closed')
    throw new IllegalStateError(ShoppingCartError.CART_CLOSED);

  const {
    data: { shoppingCartId, clientId, productItem },
    metadata,
  } = command;

  return {
    type: 'ProductItemAddedToShoppingCart',
    data: {
      shoppingCartId,
      clientId,
      productItem,
      addedAt: metadata.now,
    },
    metadata: { clientId: metadata.clientId },
  };
};

export const removeProductItem = (
  command: RemoveProductItemFromShoppingCart,
  state: ShoppingCart,
): ProductItemRemovedFromShoppingCart => {
  if (state.status !== 'Opened')
    throw new IllegalStateError(ShoppingCartError.CART_NOT_OPENED);

  const {
    data: { shoppingCartId, productItem },
    metadata,
  } = command;

  const currentQuantity = state.productItems.get(productItem.productId) ?? 0;

  if (currentQuantity < productItem.quantity)
    throw new IllegalStateError(ShoppingCartError.INSUFFICIENT_QUANTITY);

  return {
    type: 'ProductItemRemovedFromShoppingCart',
    data: {
      shoppingCartId,
      productItem,
      removedAt: metadata.now,
    },
    metadata: { clientId: metadata.clientId },
  };
};

export const confirm = (
  command: ConfirmShoppingCart,
  state: ShoppingCart,
): ShoppingCartConfirmed => {
  if (state.status !== 'Opened')
    throw new IllegalStateError(ShoppingCartError.CART_NOT_OPENED);

  const totalQuantityOfAllProductItems = sum(state.productItems.values());

  if (totalQuantityOfAllProductItems <= 0)
    throw new IllegalStateError(ShoppingCartError.CART_EMPTY);

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return {
    type: 'ShoppingCartConfirmed',
    data: {
      shoppingCartId,
      confirmedAt: metadata.now,
    },
    metadata: { clientId: metadata.clientId },
  };
};

export const cancel = (
  command: CancelShoppingCart,
  state: ShoppingCart,
): ShoppingCartCancelled => {
  if (state.status !== 'Opened')
    throw new IllegalStateError(ShoppingCartError.CART_NOT_OPENED);

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return {
    type: 'ShoppingCartCancelled',
    data: {
      shoppingCartId,
      cancelledAt: metadata.now,
    },
    metadata: { clientId: metadata.clientId },
  };
};

export const decide = (command: ShoppingCartCommand, state: ShoppingCart) => {
  const { type } = command;

  switch (type) {
    case 'AddProductItemToShoppingCart':
      return addProductItem(command, state);
    case 'RemoveProductItemFromShoppingCart':
      return removeProductItem(command, state);
    case 'ConfirmShoppingCart':
      return confirm(command, state);
    case 'CancelShoppingCart':
      return cancel(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
};

export const decider: Decider<
  ShoppingCart,
  ShoppingCartCommand,
  ShoppingCartEvent
> = {
  decide,
  evolve,
  initialState,
};
