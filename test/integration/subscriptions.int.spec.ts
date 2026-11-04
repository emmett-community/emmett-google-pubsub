import type { Event } from '@event-driven-io/emmett';
import { serialize } from '../../src';
import { createInMemoryMessageBus, InMemoryPubSub } from '../../src/testing';
import { createTestEvent, waitFor, wait } from './helpers';
import type { TestEvent } from './helpers';

const metadataOf = (message: unknown) =>
  (message as { metadata?: Record<string, unknown> }).metadata;

const topicOf = (prefix: string) => `${prefix}-evt-TestEvent`;

const withMetadata = (metadata: Record<string, unknown>): TestEvent =>
  ({ ...createTestEvent('1', 'v'), metadata }) as TestEvent;

describe('Subscriptions Integration Tests', () => {
  const buses: Array<{ close(): Promise<void> }> = [];
  const track = <T extends { close(): Promise<void> }>(bus: T): T => {
    buses.push(bus);
    return bus;
  };

  afterEach(async () => {
    await Promise.all(buses.splice(0).map((bus) => bus.close()));
  });

  describe('message id and attributes', () => {
    it('hands the message id to handlers in the metadata', async () => {
      const bus = track(createInMemoryMessageBus());
      const received: TestEvent[] = [];
      bus.subscribe(async (event: TestEvent) => void received.push(event), 'TestEvent');
      await bus.start();

      await bus.publish(createTestEvent('1', 'v'));
      await waitFor(() => received.length === 1);

      expect(metadataOf(received[0])).toMatchObject({
        messageId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      });
    });

    it('keeps the message id the event already had, such as the event store one', async () => {
      const bus = track(createInMemoryMessageBus());
      const received: TestEvent[] = [];
      bus.subscribe(async (event: TestEvent) => void received.push(event), 'TestEvent');
      await bus.start();

      await bus.publish(withMetadata({ messageId: 'store-1', schemaVersion: 2 }));
      await bus.publish(withMetadata({ messageId: 'store-1', schemaVersion: 2 }));
      await waitFor(() => received.length === 2);

      expect(received.map((e) => metadataOf(e)?.messageId)).toEqual([
        'store-1',
        'store-1',
      ]);
      expect(metadataOf(received[0])).toMatchObject({ schemaVersion: 2 });
    });

    it('publishes messageId and schemaVersion as attributes', async () => {
      const pubsub = new InMemoryPubSub();
      const prefix = 'attrs';
      const bus = track(createInMemoryMessageBus({ pubsub, topicPrefix: prefix }));
      const raw = pubsub.topic(topicOf(prefix)).subscription('raw');
      await raw.create();
      const seen: Array<Record<string, string> | undefined> = [];
      raw.on('message', (m: { attributes?: Record<string, string>; ack(): void }) => {
        seen.push(m.attributes);
        m.ack();
      });

      await bus.publish(withMetadata({ messageId: 'store-9', schemaVersion: 2 }));
      await waitFor(() => seen.length === 1);

      expect(seen[0]).toMatchObject({
        messageType: 'TestEvent',
        messageKind: 'event',
        messageId: 'store-9',
        schemaVersion: '2',
      });
    });

    it('exposes the traceparent attribute to handlers', async () => {
      const pubsub = new InMemoryPubSub();
      const prefix = 'trace';
      const bus = track(createInMemoryMessageBus({ pubsub, topicPrefix: prefix }));
      const received: TestEvent[] = [];
      bus.subscribe(async (event: TestEvent) => void received.push(event), 'TestEvent');
      await bus.start();
      const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

      await pubsub.topic(topicOf(prefix)).publishMessage({
        data: serialize(createTestEvent('1', 'v') as Event, 'm-1'),
        attributes: { messageType: 'TestEvent', messageKind: 'event', traceparent },
      });
      await waitFor(() => received.length === 1);

      expect(metadataOf(received[0])).toMatchObject({ messageId: 'm-1', traceparent });
    });
  });

  describe('bus subscription id', () => {
    it('shares one subscription between replicas: each message goes to one of them', async () => {
      const pubsub = new InMemoryPubSub();
      const options = { pubsub, topicPrefix: 'compete', subscriptionId: 'svc' };
      const replicaA = track(createInMemoryMessageBus(options));
      const replicaB = track(createInMemoryMessageBus(options));
      const gotA: string[] = [];
      const gotB: string[] = [];
      replicaA.subscribe(async (e: TestEvent) => void gotA.push(e.data.id), 'TestEvent');
      replicaB.subscribe(async (e: TestEvent) => void gotB.push(e.data.id), 'TestEvent');
      await replicaA.start();
      await replicaB.start();

      for (let i = 0; i < 20; i++) {
        await replicaA.publish(createTestEvent(String(i), 'v'));
      }
      await waitFor(() => gotA.length + gotB.length >= 20);
      await wait(100);

      const all = [...gotA, ...gotB];
      expect(all).toHaveLength(20);
      expect(new Set(all).size).toBe(20);
      expect(gotA.length).toBeGreaterThan(0);
      expect(gotB.length).toBeGreaterThan(0);
    });

    it('runs every handler of the service for an event type on one subscription', async () => {
      const bus = track(createInMemoryMessageBus({ subscriptionId: 'svc' }));
      const calls: string[] = [];
      bus.subscribe(async () => void calls.push('first'), 'TestEvent');
      bus.subscribe(async () => void calls.push('second'), 'TestEvent');
      await bus.start();

      await bus.publish(createTestEvent('1', 'v'));
      await waitFor(() => calls.length === 2);
      await wait(50);

      expect(calls.sort()).toEqual(['first', 'second']);
    });

    it('runs handlers registered after start too', async () => {
      const bus = track(createInMemoryMessageBus({ subscriptionId: 'svc' }));
      const calls: string[] = [];
      bus.subscribe(async () => void calls.push('before'), 'TestEvent');
      await bus.start();
      bus.subscribe(async () => void calls.push('after'), 'TestEvent');

      await bus.publish(createTestEvent('1', 'v'));
      await waitFor(() => calls.length === 2);

      expect(calls.sort()).toEqual(['after', 'before']);
    });

    it('routes each event type to its own handlers', async () => {
      const bus = track(createInMemoryMessageBus({ subscriptionId: 'svc' }));
      const forTest: string[] = [];
      const forOther: string[] = [];
      bus.subscribe(async (e: TestEvent) => void forTest.push(e.type), 'TestEvent');
      bus.subscribe(async (e: Event) => void forOther.push(e.type), 'OtherEvent');
      await bus.start();

      await bus.publish(createTestEvent('1', 'v'));
      await bus.publish({ type: 'OtherEvent', data: {} } as Event);
      await waitFor(() => forTest.length === 1 && forOther.length === 1);
      await wait(50);

      expect(forTest).toEqual(['TestEvent']);
      expect(forOther).toEqual(['OtherEvent']);
    });

    it('delivers every message to every replica when a subscriber asks for fan-out', async () => {
      const pubsub = new InMemoryPubSub();
      const options = { pubsub, topicPrefix: 'fanout', subscriptionId: 'svc' };
      const replicaA = track(createInMemoryMessageBus(options));
      const replicaB = track(createInMemoryMessageBus(options));
      const gotA: string[] = [];
      const gotB: string[] = [];
      replicaA.subscribeWithOptions(async (e: TestEvent) => void gotA.push(e.data.id), ['TestEvent'], {
        fanOut: true,
      });
      replicaB.subscribeWithOptions(async (e: TestEvent) => void gotB.push(e.data.id), ['TestEvent'], {
        fanOut: true,
      });
      await replicaA.start();
      await replicaB.start();

      await replicaA.publish(createTestEvent('1', 'v'));
      await waitFor(() => gotA.length === 1 && gotB.length === 1);
    });

    it('warns once, outside the emulator, when subscribing without a subscription id', () => {
      const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const bus = track(createInMemoryMessageBus({ useEmulator: false, observability: { logger } }));

      bus.subscribe(async () => undefined, 'TestEvent');
      bus.subscribe(async () => undefined, 'OtherEvent');

      const warnings = logger.warn.mock.calls.filter(([, message]) =>
        String(message).includes('subscriptionId'),
      );
      expect(warnings).toHaveLength(1);
    });

    it('does not warn when a subscription id is configured', () => {
      const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const bus = track(
        createInMemoryMessageBus({
          useEmulator: false,
          subscriptionId: 'svc',
          observability: { logger },
        }),
      );

      bus.subscribe(async () => undefined, 'TestEvent');

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('explicit subscription id', () => {
    it('delivers every message to each distinct subscription id', async () => {
      const bus = track(createInMemoryMessageBus());
      const first: string[] = [];
      const second: string[] = [];
      bus.subscribeWithOptions(async (e: TestEvent) => void first.push(e.data.id), ['TestEvent'], {
        subscriptionId: 'one',
      });
      bus.subscribeWithOptions(async (e: TestEvent) => void second.push(e.data.id), ['TestEvent'], {
        subscriptionId: 'two',
      });
      await bus.start();

      await bus.publish(createTestEvent('1', 'v'));
      await waitFor(() => first.length === 1 && second.length === 1);
    });

    it('rejects registering the same subscription id twice for one event type', () => {
      const bus = track(createInMemoryMessageBus());
      bus.subscribeWithOptions(async () => undefined, ['TestEvent'], { subscriptionId: 'dup' });

      expect(() =>
        bus.subscribeWithOptions(async () => undefined, ['TestEvent'], { subscriptionId: 'dup' }),
      ).toThrow(/already registered/);
    });

    it('without a bus subscription id, plain subscribe gives each handler its own subscription', async () => {
      const bus = track(createInMemoryMessageBus());
      let calls = 0;
      bus.subscribe(async () => void calls++, 'TestEvent');
      bus.subscribe(async () => void calls++, 'TestEvent');
      await bus.start();

      await bus.publish(createTestEvent('1', 'v'));
      await waitFor(() => calls === 2);
    });
  });

  describe('per-subscription topic prefix', () => {
    it('reads events published under another prefix', async () => {
      const pubsub = new InMemoryPubSub();
      const publisher = track(createInMemoryMessageBus({ pubsub, topicPrefix: 'pantry' }));
      const consumer = track(createInMemoryMessageBus({ pubsub, topicPrefix: 'shopping' }));
      const received: string[] = [];
      consumer.subscribeWithOptions(
        async (e: TestEvent) => void received.push(e.data.id),
        ['TestEvent'],
        { subscriptionId: 'from-pantry', topicPrefix: 'pantry' },
      );
      await consumer.start();

      await publisher.publish(createTestEvent('1', 'v'));
      await waitFor(() => received.length === 1);

      expect(received).toEqual(['1']);
    });
  });

  describe('dead letter topic', () => {
    it('creates the topic, redelivers up to the max attempts and then dead-letters', async () => {
      const pubsub = new InMemoryPubSub();
      const prefix = 'dlq';
      const bus = track(createInMemoryMessageBus({ pubsub, topicPrefix: prefix }));
      let attempts = 0;
      bus.subscribeWithOptions(
        async () => {
          attempts++;
          throw new Error('boom');
        },
        ['TestEvent'],
        {
          subscriptionId: 'failing',
          deadLetterPolicy: { deadLetterTopic: 'failing-dlq', maxDeliveryAttempts: 3 },
        },
      );
      await bus.start();

      expect(await pubsub.topic('failing-dlq').exists()).toEqual([true]);

      const dead: Array<{ attributes?: Record<string, string> }> = [];
      const dlqSub = pubsub.topic('failing-dlq').subscription('inspect');
      await dlqSub.create();
      dlqSub.on('message', (m: { attributes?: Record<string, string>; ack(): void }) => {
        dead.push(m);
        m.ack();
      });

      await bus.publish(withMetadata({ messageId: 'poison-1' }));
      await waitFor(() => dead.length === 1);

      expect(attempts).toBe(3);
      expect(dead[0].attributes).toMatchObject({ messageId: 'poison-1' });
    });

    it('does not dead-letter a message that succeeds on retry', async () => {
      const pubsub = new InMemoryPubSub();
      const bus = track(createInMemoryMessageBus({ pubsub, topicPrefix: 'flaky' }));
      let attempts = 0;
      bus.subscribeWithOptions(
        async () => {
          if (++attempts < 2) throw new Error('transient');
        },
        ['TestEvent'],
        {
          subscriptionId: 'flaky',
          deadLetterPolicy: { deadLetterTopic: 'flaky-dlq', maxDeliveryAttempts: 5 },
        },
      );
      await bus.start();
      const dead: unknown[] = [];
      const dlqSub = pubsub.topic('flaky-dlq').subscription('inspect');
      await dlqSub.create();
      dlqSub.on('message', (m: unknown) => void dead.push(m));

      await bus.publish(createTestEvent('1', 'v'));
      await waitFor(() => attempts === 2);
      await wait(100);

      expect(dead).toHaveLength(0);
    });
  });

  describe('publishing a topic that another publisher creates first', () => {
    it('ignores ALREADY_EXISTS (code 6) from topic.create()', async () => {
      const pubsub = new InMemoryPubSub();
      const prefix = 'race';
      const bus = track(createInMemoryMessageBus({ pubsub, topicPrefix: prefix }));
      jest
        .spyOn(pubsub.topic(topicOf(prefix)), 'create')
        .mockRejectedValue(Object.assign(new Error('already exists'), { code: 6 }));

      await expect(bus.publish(createTestEvent('1', 'v'))).resolves.toBeUndefined();
    });

    it('still throws other errors from topic.create()', async () => {
      const pubsub = new InMemoryPubSub();
      const prefix = 'race-other';
      const bus = track(createInMemoryMessageBus({ pubsub, topicPrefix: prefix }));
      jest
        .spyOn(pubsub.topic(topicOf(prefix)), 'create')
        .mockRejectedValue(Object.assign(new Error('permission denied'), { code: 7 }));

      await expect(bus.publish(createTestEvent('1', 'v'))).rejects.toThrow('permission denied');
    });
  });
});
