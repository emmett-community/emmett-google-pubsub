import { DeciderSpecification } from '@event-driven-io/emmett';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { decide, ShoppingCartError } from '../src/shoppingCarts/businessLogic';
import {
  evolve,
  initialState,
  type PricedProductItem,
} from '../src/shoppingCarts/shoppingCart';

const given = DeciderSpecification.for({
  decide,
  evolve,
  initialState,
});

void describe('ShoppingCart business logic', () => {
  void describe('When empty', () => {
    void it('adds product item', () => {
      given([])
        .when({
          type: 'AddProductItemToShoppingCart',
          data: {
            shoppingCartId,
            clientId,
            productItem,
          },
          metadata: { clientId, now },
        })
        .then([
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
        ]);
    });
  });

  void describe('When opened', () => {
    void it('confirms the cart', () => {
      given({
        type: 'ProductItemAddedToShoppingCart',
        data: {
          shoppingCartId,
          clientId,
          productItem,
          addedAt: oldTime,
        },
        metadata: { clientId },
      })
        .when({
          type: 'ConfirmShoppingCart',
          data: {
            shoppingCartId,
          },
          metadata: { clientId, now },
        })
        .then([
          {
            type: 'ShoppingCartConfirmed',
            data: {
              shoppingCartId,
              confirmedAt: now,
            },
            metadata: { clientId },
          },
        ]);
    });
  });

  void describe('When confirmed', () => {
    void it('rejects new items', () => {
      given([
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
      ])
        .when({
          type: 'AddProductItemToShoppingCart',
          data: {
            shoppingCartId,
            clientId,
            productItem,
          },
          metadata: { clientId, now },
        })
        .thenThrows(
          (error: Error) => error.message === ShoppingCartError.CART_CLOSED,
        );
    });
  });

  const getRandomProduct = (): PricedProductItem => {
    return {
      productId: randomUUID(),
      unitPrice: Math.random() * 10,
      quantity: Math.floor(Math.random() * 10) + 1,
    };
  };
  const oldTime = new Date();
  const now = new Date();
  const shoppingCartId = randomUUID();
  const clientId = randomUUID();

  const productItem = getRandomProduct();
});
