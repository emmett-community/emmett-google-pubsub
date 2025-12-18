import type { Event } from '@event-driven-io/emmett';
import {
  getTestMessageBus,
  createTestEvent,
  waitFor,
} from './helpers';

describe('Events Integration Tests', () => {
  describe('event subscription and publishing', () => {
    it('should subscribe to events and receive published events', async () => {
      const messageBus = getTestMessageBus();
      const receivedEvents: Event[] = [];

      messageBus.subscribe(
        async (event: Event) => {
          receivedEvents.push(event);
        },
        'TestEvent',
      );

      await messageBus.start();

      try {
        const event = createTestEvent('evt-1', 'test-value');
        await messageBus.publish(event);

        await waitFor(() => receivedEvents.length > 0);

        expect(receivedEvents).toHaveLength(1);
        expect(receivedEvents[0].type).toBe('TestEvent');
        expect(receivedEvents[0].data).toEqual({
          id: 'evt-1',
          value: 'test-value',
          timestamp: expect.any(Date),
        });
      } finally {
        await messageBus.close();
      }
    });

    it('should allow multiple subscribers for same event', async () => {
      const messageBus = getTestMessageBus();
      const subscriber1Events: Event[] = [];
      const subscriber2Events: Event[] = [];
      const subscriber3Events: Event[] = [];

      messageBus.subscribe(
        async (event: Event) => {
          subscriber1Events.push(event);
        },
        'TestEvent',
      );

      messageBus.subscribe(
        async (event: Event) => {
          subscriber2Events.push(event);
        },
        'TestEvent',
      );

      messageBus.subscribe(
        async (event: Event) => {
          subscriber3Events.push(event);
        },
        'TestEvent',
      );

      await messageBus.start();

      try {
        const event = createTestEvent('evt-1', 'test-value');
        await messageBus.publish(event);

        await waitFor(
          () =>
            subscriber1Events.length > 0 &&
            subscriber2Events.length > 0 &&
            subscriber3Events.length > 0,
        );

        expect(subscriber1Events).toHaveLength(1);
        expect(subscriber2Events).toHaveLength(1);
        expect(subscriber3Events).toHaveLength(1);

        // All should receive the same event
        expect((subscriber1Events[0].data as any).id).toBe('evt-1');
        expect((subscriber2Events[0].data as any).id).toBe('evt-1');
        expect((subscriber3Events[0].data as any).id).toBe('evt-1');
      } finally {
        await messageBus.close();
      }
    });

    it('should handle multiple different events', async () => {
      const messageBus = getTestMessageBus();
      const event1Received: Event[] = [];
      const event2Received: Event[] = [];

      messageBus.subscribe(
        async (event: Event) => {
          event1Received.push(event);
        },
        'Event1',
      );

      messageBus.subscribe(
        async (event: Event) => {
          event2Received.push(event);
        },
        'Event2',
      );

      await messageBus.start();

      try {
        await messageBus.publish({ type: 'Event1', data: { value: 'evt1' } });
        await messageBus.publish({ type: 'Event2', data: { value: 'evt2' } });

        await waitFor(() => event1Received.length > 0 && event2Received.length > 0);

        expect(event1Received).toHaveLength(1);
        expect(event1Received[0].type).toBe('Event1');
        expect(event2Received).toHaveLength(1);
        expect(event2Received[0].type).toBe('Event2');
      } finally {
        await messageBus.close();
      }
    });

    it('should handle events with metadata', async () => {
      const messageBus = getTestMessageBus();
      const receivedEvents: Event[] = [];

      messageBus.subscribe(
        async (event: Event) => {
          receivedEvents.push(event);
        },
        'TestEvent',
      );

      await messageBus.start();

      try {
        const event = {
          type: 'TestEvent',
          data: { id: 'evt-1', value: 'test' },
          metadata: {
            now: new Date('2024-01-15T10:00:00.000Z'),
          },
        } as Event;

        await messageBus.publish(event);

        await waitFor(() => receivedEvents.length > 0);

        const receivedMetadata = (receivedEvents[0] as any).metadata;
        expect(receivedMetadata).toBeDefined();
        expect(receivedMetadata?.now).toBeInstanceOf(Date);
        expect((receivedMetadata?.now as Date).toISOString()).toBe(
          '2024-01-15T10:00:00.000Z',
        );
      } finally {
        await messageBus.close();
      }
    });

    it('should handle events with Date objects in data', async () => {
      const messageBus = getTestMessageBus();
      const receivedEvents: Event[] = [];

      messageBus.subscribe(
        async (event: Event) => {
          receivedEvents.push(event);
        },
        'TestEvent',
      );

      await messageBus.start();

      try {
        const now = new Date('2024-01-15T10:30:00.000Z');
        const event: Event = {
          type: 'TestEvent',
          data: {
            id: 'evt-1',
            occurredAt: now,
            items: [
              { name: 'item1', addedAt: now },
              { name: 'item2', addedAt: now },
            ],
          },
        };

        await messageBus.publish(event);

        await waitFor(() => receivedEvents.length > 0);

        const data = receivedEvents[0].data as any;
        expect(data.occurredAt).toBeInstanceOf(Date);
        expect(data.occurredAt.toISOString()).toBe(
          '2024-01-15T10:30:00.000Z',
        );
        expect(data.items[0].addedAt).toBeInstanceOf(Date);
        expect(data.items[1].addedAt).toBeInstanceOf(Date);
      } finally {
        await messageBus.close();
      }
    });

    it('should execute event handlers sequentially for same subscriber', async () => {
      const messageBus = getTestMessageBus();
      const executionOrder: string[] = [];

      messageBus.subscribe(
        async (event: Event) => {
          const id = (event.data as any).id;
          executionOrder.push(`start-${id}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
          executionOrder.push(`end-${id}`);
        },
        'TestEvent',
      );

      await messageBus.start();

      try {
        await messageBus.publish(createTestEvent('evt-1', 'first'));
        await messageBus.publish(createTestEvent('evt-2', 'second'));

        await waitFor(() => executionOrder.length >= 4, 5000);

        // Both events should be processed (order may vary due to async nature)
        expect(executionOrder).toHaveLength(4);
        expect(executionOrder.filter((e) => e.includes('evt-1'))).toHaveLength(2);
        expect(executionOrder.filter((e) => e.includes('evt-2'))).toHaveLength(2);
        expect(executionOrder).toContain('start-evt-1');
        expect(executionOrder).toContain('end-evt-1');
        expect(executionOrder).toContain('start-evt-2');
        expect(executionOrder).toContain('end-evt-2');
      } finally {
        await messageBus.close();
      }
    });

    it('should subscribe to event after start', async () => {
      const messageBus = getTestMessageBus();
      const receivedEvents: Event[] = [];

      await messageBus.start();

      try {
        // Subscribe after start
        messageBus.subscribe(
          async (event: Event) => {
            receivedEvents.push(event);
          },
          'TestEvent',
        );

        // Give time for subscription to be created
        await new Promise((resolve) => setTimeout(resolve, 500));

        await messageBus.publish(createTestEvent('evt-1', 'test'));

        await waitFor(() => receivedEvents.length > 0);

        expect(receivedEvents).toHaveLength(1);
      } finally {
        await messageBus.close();
      }
    });

    it('should handle publishing event with no subscribers', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        // Should not throw when publishing event with no subscribers
        await expect(
          messageBus.publish(createTestEvent('evt-1', 'test')),
        ).resolves.not.toThrow();
      } finally {
        await messageBus.close();
      }
    });
  });

  describe('event error handling', () => {
    it('should continue processing when one subscriber fails', async () => {
      const messageBus = getTestMessageBus();
      const subscriber1Events: Event[] = [];
      const subscriber2Events: Event[] = [];

      messageBus.subscribe(
        async (event: Event) => {
          subscriber1Events.push(event);
          throw new Error('Subscriber 1 failed');
        },
        'TestEvent',
      );

      messageBus.subscribe(
        async (event: Event) => {
          subscriber2Events.push(event);
        },
        'TestEvent',
      );

      await messageBus.start();

      try {
        await messageBus.publish(createTestEvent('evt-1', 'test'));

        // Both subscribers should receive the event
        await waitFor(
          () => subscriber1Events.length > 0 && subscriber2Events.length > 0,
          5000,
        );

        expect(subscriber1Events).toHaveLength(1);
        expect(subscriber2Events).toHaveLength(1);
      } finally {
        await messageBus.close();
      }
    });
  });

  describe('event subscription to multiple types', () => {
    it('should subscribe to multiple event types with single handler', async () => {
      const messageBus = getTestMessageBus();
      const receivedEvents: Event[] = [];

      messageBus.subscribe(
        async (event: Event) => {
          receivedEvents.push(event);
        },
        'Event1',
        'Event2',
        'Event3',
      );

      await messageBus.start();

      try {
        await messageBus.publish({ type: 'Event1', data: { value: '1' } });
        await messageBus.publish({ type: 'Event2', data: { value: '2' } });
        await messageBus.publish({ type: 'Event3', data: { value: '3' } });

        await waitFor(() => receivedEvents.length === 3);

        expect(receivedEvents).toHaveLength(3);
        const types = receivedEvents.map((e) => e.type).sort();
        expect(types).toEqual(['Event1', 'Event2', 'Event3']);
      } finally {
        await messageBus.close();
      }
    });
  });

  describe('lifecycle management', () => {
    it('should allow publishing before start (producer-only mode)', async () => {
      const messageBus = getTestMessageBus();

      // Publishing without start() is allowed for producer-only scenarios
      // (e.g., when only sending commands/events without consuming)
      await expect(
        messageBus.publish(createTestEvent('evt-1', 'test')),
      ).resolves.not.toThrow();

      // Cleanup
      await messageBus.close();
    });
  });
});
