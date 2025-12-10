import { realtimeDBInlineProjection } from '@emmett-community/emmett-google-realtime-db';
import type { Database } from 'firebase-admin/database';
import type { ShoppingCartEvent, ShoppingCartId } from '../shoppingCart';

export type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

const evolve = (
  document: ShoppingCartShortInfo | null,
  { type, data: event }: ShoppingCartEvent,
): ShoppingCartShortInfo | null => {
  // If document doesn't exist and it's not an "add" event, ignore
  // This prevents recreation after Cancel/Confirm
  if (!document && type !== 'ProductItemAddedToShoppingCart') {
    return null;
  }

  switch (type) {
    case 'ProductItemAddedToShoppingCart': {
      // Create initial state if document doesn't exist
      const baseDocument = document ?? {
        productItemsCount: 0,
        totalAmount: 0,
      };
      return {
        totalAmount:
          baseDocument.totalAmount +
          event.productItem.unitPrice * event.productItem.quantity,
        productItemsCount:
          baseDocument.productItemsCount + event.productItem.quantity,
      };
    }
    case 'ProductItemRemovedFromShoppingCart':
      // Should not happen if document is null, but guard anyway
      if (!document) return null;
      return {
        totalAmount:
          document.totalAmount -
          event.productItem.unitPrice * event.productItem.quantity,
        productItemsCount:
          document.productItemsCount - event.productItem.quantity,
      };
    case 'ShoppingCartConfirmed':
    case 'ShoppingCartCancelled':
      // delete read model
      return null;
    default:
      return document;
  }
};

export const shoppingCartShortInfoProjectionName = 'shoppingCartShortInfo';

export const getShortInfoById = async (
  database: Database,
  shoppingCartId: ShoppingCartId,
): Promise<ShoppingCartShortInfo | null> => {
  const snapshot = await database
    .ref(`projections/${shoppingCartShortInfoProjectionName}/${shoppingCartId}`)
    .once('value');
  return snapshot.val() ?? null;
};

export const shoppingCartShortInfoProjection = realtimeDBInlineProjection({
  name: shoppingCartShortInfoProjectionName,
  evolve,
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
});
