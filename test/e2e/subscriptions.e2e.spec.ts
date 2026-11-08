import path from 'node:path';
import type { Event } from '@event-driven-io/emmett';
import { Duration, PubSub } from '@google-cloud/pubsub';
import { GenericContainer, Wait } from 'testcontainers';
import { getPubSubMessageBus } from '../../src/messageBus/pubsubMessageBus';

jest.setTimeout(120000);

const projectId = 'demo-project';

let emulator: import('testcontainers').StartedTestContainer | null = null;
let emulatorHost = '';
let pubsubPort = 0;

const getPrefix = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const waitFor = async (
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10000,
  intervalMs = 100,
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const newPubSub = () =>
  new PubSub({ projectId, apiEndpoint: `${emulatorHost}:${pubsubPort}` });

// The container is healthy before its Pub/Sub emulator is warm: the first calls can take longer
// than the bus setup timeout. Round-trip a topic until the emulator answers promptly.
const warmUpPubSub = async (): Promise<void> => {
  await waitFor(
    async () => {
      const probe = new PubSub({
        projectId,
        apiEndpoint: `${emulatorHost}:${pubsubPort}`,
      });
      try {
        const attempt = (async () => {
          const [topic] = await probe.createTopic(
            `warmup-${Math.random().toString(36).slice(2, 10)}`,
          );
          await topic.delete();
        })();
        await Promise.race([
          attempt,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('warm-up timeout')), 3000),
          ),
        ]);
        return true;
      } catch {
        return false;
      } finally {
        await probe.close().catch(() => undefined);
      }
    },
    90000,
    1000,
  );
};

const createBus = (topicPrefix: string, subscriptionId?: string) =>
  getPubSubMessageBus({
    pubsub: newPubSub(),
    useEmulator: true,
    topicPrefix,
    subscriptionId,
    cleanupOnClose: false,
  });

const eventOf = (id: string, metadata?: Record<string, unknown>): Event =>
  ({ type: 'SubEvent', data: { id }, ...(metadata && { metadata }) }) as Event;

const idOf = (event: Event) => (event.data as { id: string }).id;
const metadataOf = (event: Event) =>
  (event as { metadata?: Record<string, unknown> }).metadata;

beforeAll(async () => {
  emulator = await new GenericContainer('myfstartup/firebase-emulator-suite:15')
    .withPlatform('linux/amd64')
    .withExposedPorts(8085)
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
    .withEnvironment({ PROJECT_ID: projectId, HEALTHCHECK_PORT: '4400' })
    .withWaitStrategy(Wait.forHealthCheck().withStartupTimeout(120000))
    .start();

  emulatorHost = emulator.getHost();
  pubsubPort = emulator.getMappedPort(8085);
  process.env.PUBSUB_EMULATOR_HOST = `${emulatorHost}:${pubsubPort}`;
  process.env.GCLOUD_PROJECT = projectId;

  await warmUpPubSub();
}, 230000);

afterAll(async () => {
  if (emulator) {
    await emulator.stop();
  }
});

describe('Stable subscriptions on the Pub/Sub emulator', () => {
  it('replicas sharing the bus subscription id receive each message once', async () => {
    const prefix = getPrefix();
    const replicaA = createBus(prefix, 'svc');
    const replicaB = createBus(prefix, 'svc');
    const gotA: string[] = [];
    const gotB: string[] = [];
    replicaA.subscribe(
      (e: Event) => Promise.resolve(void gotA.push(idOf(e))),
      'SubEvent',
    );
    replicaB.subscribe(
      (e: Event) => Promise.resolve(void gotB.push(idOf(e))),
      'SubEvent',
    );
    await Promise.all([replicaA.start(), replicaB.start()]);

    try {
      const total = 30;
      for (let i = 0; i < total; i++) {
        await replicaA.publish(eventOf(`m-${i}`));
      }
      await waitFor(() => gotA.length + gotB.length >= total, 30000);
      await sleep(1500); // would expose a second delivery of any message

      const all = [...gotA, ...gotB];
      expect(all).toHaveLength(total);
      expect(new Set(all).size).toBe(total);
      // eslint-disable-next-line no-console
      console.log(
        `S2 distribution: replica A ${gotA.length}, replica B ${gotB.length}`,
      );
    } finally {
      await replicaA.close();
      await replicaB.close();
    }
  });

  it('a restarted service receives what was published while it was down', async () => {
    const prefix = getPrefix();
    const received: string[] = [];
    const subscribe = (bus: ReturnType<typeof createBus>) =>
      bus.subscribe(
        (e: Event) => Promise.resolve(void received.push(idOf(e))),
        'SubEvent',
      );

    const first = createBus(prefix, 'durable');
    subscribe(first);
    await first.start();
    await first.publish(eventOf('before'));
    await waitFor(() => received.length === 1);
    await first.close(); // keeps the subscription (cleanupOnClose is off)

    const publisher = createBus(prefix);
    await publisher.publish(eventOf('while-down-1'));
    await publisher.publish(eventOf('while-down-2'));
    await publisher.close();

    const second = createBus(prefix, 'durable');
    subscribe(second);
    await second.start();

    try {
      await waitFor(() => received.length === 3, 20000);
      expect(received.sort()).toEqual([
        'before',
        'while-down-1',
        'while-down-2',
      ]);
    } finally {
      await second.close();
    }
  });

  it('delivers the event store message id and the transport attributes', async () => {
    const prefix = getPrefix();
    const bus = createBus(prefix);
    const received: Event[] = [];
    bus.subscribe(
      (e: Event) => Promise.resolve(void received.push(e)),
      'SubEvent',
    );
    await bus.start();

    const raw = newPubSub();
    const rawSub = raw
      .topic(`${prefix}-evt-SubEvent`)
      .subscription('raw-attrs');
    await rawSub.create();
    const attributes: Array<Record<string, string>> = [];
    rawSub.on('message', (m) => {
      attributes.push(m.attributes);
      m.ack();
    });

    try {
      await bus.publish(
        eventOf('with-id', { messageId: 'store-42', schemaVersion: 2 }),
      );
      await waitFor(() => received.length === 1 && attributes.length === 1);

      expect(metadataOf(received[0])).toMatchObject({
        messageId: 'store-42',
        schemaVersion: 2,
      });
      expect(attributes[0]).toMatchObject({
        messageType: 'SubEvent',
        messageKind: 'event',
        messageId: 'store-42',
        schemaVersion: '2',
      });
    } finally {
      await rawSub.close();
      await raw.close();
      await bus.close();
    }
  });

  it('runs every handler of the service for an event on the one shared subscription', async () => {
    const prefix = getPrefix();
    const bus = createBus(prefix, 'svc');
    const calls: string[] = [];
    bus.subscribe(() => Promise.resolve(void calls.push('first')), 'SubEvent');
    bus.subscribe(() => Promise.resolve(void calls.push('second')), 'SubEvent');
    await bus.start();

    try {
      await bus.publish(eventOf('shared'));
      await waitFor(() => calls.length === 2);
      await sleep(500);
      expect(calls.sort()).toEqual(['first', 'second']);
    } finally {
      await bus.close();
    }
  });

  it('delivers every message to every replica when a subscriber asks for fan-out', async () => {
    const prefix = getPrefix();
    const replicaA = createBus(prefix, 'svc');
    const replicaB = createBus(prefix, 'svc');
    const gotA: string[] = [];
    const gotB: string[] = [];
    replicaA.subscribeWithOptions(
      (e: Event) => Promise.resolve(void gotA.push(idOf(e))),
      ['SubEvent'],
      {
        fanOut: true,
      },
    );
    replicaB.subscribeWithOptions(
      (e: Event) => Promise.resolve(void gotB.push(idOf(e))),
      ['SubEvent'],
      {
        fanOut: true,
      },
    );
    await Promise.all([replicaA.start(), replicaB.start()]);

    try {
      await replicaA.publish(eventOf('everyone'));
      await waitFor(() => gotA.length === 1 && gotB.length === 1);
    } finally {
      await replicaA.close();
      await replicaB.close();
    }
  });

  it('works with client flow control and acknowledgement deadline options', async () => {
    const bus = getPubSubMessageBus({
      pubsub: newPubSub(),
      useEmulator: true,
      topicPrefix: getPrefix(),
      subscriptionId: 'svc',
      subscriptionOptions: {
        subscriber: {
          flowControl: { maxMessages: 3 },
          minAckDeadline: Duration.from({ seconds: 20 }),
          maxAckDeadline: Duration.from({ seconds: 60 }),
        },
      },
    });
    const received: string[] = [];
    bus.subscribe(
      (e: Event) => Promise.resolve(void received.push(idOf(e))),
      'SubEvent',
    );
    await bus.start();

    try {
      for (let i = 0; i < 10; i++) {
        await bus.publish(eventOf(`flow-${i}`));
      }
      await waitFor(() => received.length === 10, 30000);
      expect(new Set(received).size).toBe(10);
    } finally {
      await bus.close();
    }
  });

  it('reads events published under another prefix', async () => {
    const pantry = getPrefix();
    const publisher = createBus(pantry);
    const consumer = createBus(getPrefix());
    const received: string[] = [];
    consumer.subscribeWithOptions(
      (e: Event) => Promise.resolve(void received.push(idOf(e))),
      ['SubEvent'],
      {
        subscriptionId: 'from-pantry',
        topicPrefix: pantry,
      },
    );
    await consumer.start();

    try {
      await publisher.publish(eventOf('cross-prefix'));
      await waitFor(() => received.length === 1);
      expect(received).toEqual(['cross-prefix']);
    } finally {
      await publisher.close();
      await consumer.close();
    }
  });

  it('concurrent first publishes to a new topic do not fail on the create race', async () => {
    const prefix = getPrefix();
    const publishers = Array.from({ length: 8 }, () => createBus(prefix));

    try {
      await expect(
        Promise.all(
          publishers.map((bus, i) => bus.publish(eventOf(`race-${i}`))),
        ),
      ).resolves.toBeDefined();
    } finally {
      await Promise.all(publishers.map((bus) => bus.close()));
    }
  });

  it('creates the dead letter topic and dead-letters a message that keeps failing', async () => {
    const prefix = getPrefix();
    const dlqName = `${prefix}-dlq`;
    const bus = createBus(prefix);
    let attempts = 0;
    bus.subscribeWithOptions(
      () => {
        attempts++;
        throw new Error('boom');

        return Promise.resolve();
      },
      ['SubEvent'],
      {
        subscriptionId: 'failing',
        deadLetterPolicy: { deadLetterTopic: dlqName, maxDeliveryAttempts: 5 },
      },
    );
    await bus.start();

    const raw = newPubSub();
    const [dlqExists] = await raw.topic(dlqName).exists();
    expect(dlqExists).toBe(true);

    const dlqSub = raw.topic(dlqName).subscription('dlq-inspect');
    await dlqSub.create();
    const dead: Array<Record<string, string>> = [];
    dlqSub.on('message', (m) => {
      dead.push(m.attributes);
      m.ack();
    });

    try {
      await bus.publish(eventOf('poison', { messageId: 'poison-1' }));
      await waitFor(() => dead.length === 1, 60000, 250);

      expect(attempts).toBeGreaterThanOrEqual(5);
      expect(dead[0]).toMatchObject({ messageId: 'poison-1' });
    } finally {
      await dlqSub.close();
      await raw.close();
      await bus.close();
    }
  }, 90000);
});
