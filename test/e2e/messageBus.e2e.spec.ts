import path from 'node:path';
import type { Command, Event } from '@event-driven-io/emmett';
import { PubSub } from '@google-cloud/pubsub';
import { GenericContainer, Wait } from 'testcontainers';
import { getPubSubMessageBus } from '../../src/messageBus/pubsubMessageBus';

jest.setTimeout(120000);

const projectId = 'demo-project';

let emulator: import('testcontainers').StartedTestContainer | null = null;
let emulatorHost = '';
let pubsubPort = 0;

const getTopicPrefix = () =>
  `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const waitFor = async (
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
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

const startEmulator = async () => {
  const container = await new GenericContainer(
    'myfstartup/firebase-emulator-suite:15',
  )
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

  emulatorHost = container.getHost();
  pubsubPort = container.getMappedPort(8085);

  process.env.PUBSUB_EMULATOR_HOST = `${emulatorHost}:${pubsubPort}`;
  process.env.PUBSUB_PROJECT_ID = projectId;
  process.env.GCLOUD_PROJECT = projectId;

  return container;
};

const createMessageBus = (options?: { topicPrefix?: string }) => {
  const pubsub = new PubSub({
    projectId,
    apiEndpoint: `${emulatorHost}:${pubsubPort}`,
  });

  return getPubSubMessageBus({
    pubsub,
    useEmulator: true,
    topicPrefix: options?.topicPrefix ?? getTopicPrefix(),
    cleanupOnClose: true,
  });
};

beforeAll(async () => {
  emulator = await startEmulator();
});

afterAll(async () => {
  if (emulator) {
    await emulator.stop();
  }
});

describe('PubSub message bus e2e', () => {
  it('delivers commands and events through emulator', async () => {
    const messageBus = createMessageBus();

    const receivedCommands: Command[] = [];
    const receivedEvents: Event[] = [];

    messageBus.handle(
      async (command: Command) => {
        receivedCommands.push(command);
      },
      'TestCommand',
    );

    messageBus.subscribe(
      async (event: Event) => {
        receivedEvents.push(event);
      },
      'TestEvent',
    );

    await messageBus.start();

    try {
      await messageBus.send({
        type: 'TestCommand',
        data: { id: 'cmd-1', value: 'test' },
      });

      await messageBus.publish({
        type: 'TestEvent',
        data: { id: 'evt-1', value: 'test' },
      });

      await waitFor(
        () => receivedCommands.length === 1 && receivedEvents.length === 1,
        10000,
      );

      expect(receivedCommands[0].type).toBe('TestCommand');
      expect((receivedCommands[0].data as any).id).toBe('cmd-1');
      expect(receivedEvents[0].type).toBe('TestEvent');
      expect((receivedEvents[0].data as any).id).toBe('evt-1');
    } finally {
      await messageBus.close();
    }
  });

  it('delivers events to all subscribers', async () => {
    const messageBus = createMessageBus();

    const subscriberA: Event[] = [];
    const subscriberB: Event[] = [];

    messageBus.subscribe(
      async (event: Event) => {
        subscriberA.push(event);
      },
      'TestEvent',
    );

    messageBus.subscribe(
      async (event: Event) => {
        subscriberB.push(event);
      },
      'TestEvent',
    );

    await messageBus.start();

    try {
      await messageBus.publish({
        type: 'TestEvent',
        data: { id: 'evt-fanout', value: 'test' },
      });

      await waitFor(
        () => subscriberA.length === 1 && subscriberB.length === 1,
        10000,
      );

      expect((subscriberA[0].data as any).id).toBe('evt-fanout');
      expect((subscriberB[0].data as any).id).toBe('evt-fanout');
    } finally {
      await messageBus.close();
    }
  });

  it('routes multiple command types to their handlers', async () => {
    const messageBus = createMessageBus();

    const receivedA: Command[] = [];
    const receivedB: Command[] = [];

    messageBus.handle(
      async (command: Command) => {
        receivedA.push(command);
      },
      'TestCommandA',
    );

    messageBus.handle(
      async (command: Command) => {
        receivedB.push(command);
      },
      'TestCommandB',
    );

    await messageBus.start();

    try {
      await messageBus.send({
        type: 'TestCommandA',
        data: { id: 'cmd-a', value: 'alpha' },
      });

      await messageBus.send({
        type: 'TestCommandB',
        data: { id: 'cmd-b', value: 'beta' },
      });

      await waitFor(
        () => receivedA.length === 1 && receivedB.length === 1,
        10000,
      );

      expect((receivedA[0].data as any).id).toBe('cmd-a');
      expect((receivedB[0].data as any).id).toBe('cmd-b');
    } finally {
      await messageBus.close();
    }
  });

  it('allows producer-only bus to send and publish without start', async () => {
    const topicPrefix = getTopicPrefix();
    const consumer = createMessageBus({ topicPrefix });
    const producer = createMessageBus({ topicPrefix });

    const receivedCommands: Command[] = [];
    const receivedEvents: Event[] = [];

    consumer.handle(
      async (command: Command) => {
        receivedCommands.push(command);
      },
      'ProducerOnlyCommand',
    );

    consumer.subscribe(
      async (event: Event) => {
        receivedEvents.push(event);
      },
      'ProducerOnlyEvent',
    );

    await consumer.start();

    try {
      await producer.send({
        type: 'ProducerOnlyCommand',
        data: { id: 'cmd-producer', value: 'test' },
      });

      await producer.publish({
        type: 'ProducerOnlyEvent',
        data: { id: 'evt-producer', value: 'test' },
      });

      await waitFor(
        () => receivedCommands.length === 1 && receivedEvents.length === 1,
        10000,
      );

      expect((receivedCommands[0].data as any).id).toBe('cmd-producer');
      expect((receivedEvents[0].data as any).id).toBe('evt-producer');
    } finally {
      await consumer.close();
      await producer.close();
    }
  });

  it('delivers events to subscribers across message bus instances', async () => {
    const topicPrefix = getTopicPrefix();
    const busA = createMessageBus({ topicPrefix });
    const busB = createMessageBus({ topicPrefix });

    const receivedA: Event[] = [];
    const receivedB: Event[] = [];

    busA.subscribe(
      async (event: Event) => {
        receivedA.push(event);
      },
      'SharedEvent',
    );

    busB.subscribe(
      async (event: Event) => {
        receivedB.push(event);
      },
      'SharedEvent',
    );

    await Promise.all([busA.start(), busB.start()]);

    try {
      await busA.publish({
        type: 'SharedEvent',
        data: { id: 'evt-shared', value: 'test' },
      });

      await waitFor(
        () => receivedA.length === 1 && receivedB.length === 1,
        10000,
      );

      expect((receivedA[0].data as any).id).toBe('evt-shared');
      expect((receivedB[0].data as any).id).toBe('evt-shared');
    } finally {
      await busA.close();
      await busB.close();
    }
  });

  it('preserves metadata in event delivery', async () => {
    const messageBus = createMessageBus();
    const receivedEvents: Event[] = [];

    messageBus.subscribe(
      async (event: Event) => {
        receivedEvents.push(event);
      },
      'MetadataEvent',
    );

    await messageBus.start();

    try {
      const event = {
        type: 'MetadataEvent',
        data: { id: 'evt-meta', value: 'test' },
        metadata: {
          now: new Date('2024-01-15T10:00:00.000Z'),
        },
      } as Event;

      await messageBus.publish(event);

      await waitFor(() => receivedEvents.length === 1, 10000);

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
});
