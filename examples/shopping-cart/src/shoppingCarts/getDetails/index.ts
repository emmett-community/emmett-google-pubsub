import { merge } from '@event-driven-io/emmett';
import { realtimeDBInlineProjection } from '@emmett-community/emmett-google-realtime-db';
import type { Database } from 'firebase-admin/database';
import type {
  PricedProductItem,
  ShoppingCartEvent,
  ShoppingCartId,
} from '../shoppingCart';

export type ShoppingCartDetails = {
  id: string;
  clientId: string;
  productItems: PricedProductItem[];
  productItemsCount: number;
  totalAmount: number;
  status: 'Opened' | 'Confirmed' | 'Cancelled';
  openedAt: Date;
  confirmedAt?: Date | undefined;
  cancelledAt?: Date | undefined;
};

const evolve = (
  documentFromDb: ShoppingCartDetails | null,
  { type, data: event }: ShoppingCartEvent,
): ShoppingCartDetails | null => {
  switch (type) {
    case 'ProductItemAddedToShoppingCart': {
      const document = documentFromDb ?? {
        id: event.shoppingCartId,
        status: 'Opened' as const,
        productItems: [],
        totalAmount: 0,
        productItemsCount: 0,
      };

      const {
        productItem,
        productItem: { productId, quantity, unitPrice },
        clientId,
      } = event;

      return {
        ...document,
        openedAt: 'openedAt' in document ? document.openedAt : event.addedAt,
        clientId: clientId,
        productItems: merge(
          document.productItems,
          event.productItem,
          (p) => p.productId === productId && p.unitPrice === unitPrice,
          (p) => {
            return {
              ...p,
              quantity: p.quantity + quantity,
            };
          },
          () => productItem,
        ),
        totalAmount:
          document.totalAmount +
          event.productItem.unitPrice * event.productItem.quantity,
        productItemsCount:
          document?.productItemsCount + event.productItem.quantity,
      };
    }
    case 'ProductItemRemovedFromShoppingCart': {
      const {
        productItem,
        productItem: { productId, quantity, unitPrice },
      } = event;

      return {
        ...documentFromDb!,
        productItems: merge(
          documentFromDb!.productItems,
          productItem,
          (p) => p.productId === productId && p.unitPrice === unitPrice,
          (p) => {
            return {
              ...p,
              quantity: p.quantity - quantity,
            };
          },
        ),
        totalAmount:
          documentFromDb!.totalAmount -
          event.productItem.unitPrice * event.productItem.quantity,
        productItemsCount:
          documentFromDb!.productItemsCount - event.productItem.quantity,
      };
    }
    case 'ShoppingCartConfirmed':
      return {
        ...documentFromDb!,
        status: 'Confirmed',
        confirmedAt: event.confirmedAt,
      };
    case 'ShoppingCartCancelled':
      return {
        ...documentFromDb!,
        status: 'Cancelled',
        cancelledAt: event.cancelledAt,
      };
    default:
      return documentFromDb;
  }
};

export const shoppingCartDetailsProjectionName = 'shoppingCartDetails';

export const getDetailsById = async (
  database: Database,
  shoppingCartId: ShoppingCartId,
): Promise<ShoppingCartDetails | null> => {
  const snapshot = await database
    .ref(`projections/${shoppingCartDetailsProjectionName}/${shoppingCartId}`)
    .once('value');
  return snapshot.val() ?? null;
};

export const shoppingCartDetailsProjection = realtimeDBInlineProjection({
  name: shoppingCartDetailsProjectionName,
  evolve,
  canHandle: [
    'ProductItemAddedToShoppingCart',
    'ProductItemRemovedFromShoppingCart',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
});
