import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Command, Event } from '@event-driven-io/emmett';
import { PubSub } from '@google-cloud/pubsub';
import { GenericContainer, Wait } from 'testcontainers';
import { getPubSubMessageBus } from '../../src/messageBus/pubsubMessageBus';
import { dataOf, metadataOf } from '../support/accessors';

const execFileAsync = promisify(execFile);

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

// The container is healthy before its Pub/Sub emulator is warm: the first calls can take longer
// than the bus setup timeout. Round-trip a topic until the emulator answers promptly.
const warmUpPubSub = async (
  host: string = emulatorHost,
  port: number = pubsubPort,
): Promise<void> => {
  await waitFor(
    async () => {
      const probe = new PubSub({ projectId, apiEndpoint: `${host}:${port}` });
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
  await warmUpPubSub();
}, 230000);

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

    messageBus.handle((command: Command) => {
      receivedCommands.push(command);

      return Promise.resolve();
    }, 'TestCommand');

    messageBus.subscribe((event: Event) => {
      receivedEvents.push(event);

      return Promise.resolve();
    }, 'TestEvent');

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
      expect(dataOf(receivedCommands[0]).id).toBe('cmd-1');
      expect(receivedEvents[0].type).toBe('TestEvent');
      expect(dataOf(receivedEvents[0]).id).toBe('evt-1');
    } finally {
      await messageBus.close();
    }
  });

  it('delivers events to all subscribers', async () => {
    const messageBus = createMessageBus();

    const subscriberA: Event[] = [];
    const subscriberB: Event[] = [];

    messageBus.subscribe((event: Event) => {
      subscriberA.push(event);

      return Promise.resolve();
    }, 'TestEvent');

    messageBus.subscribe((event: Event) => {
      subscriberB.push(event);

      return Promise.resolve();
    }, 'TestEvent');

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

      expect(dataOf(subscriberA[0]).id).toBe('evt-fanout');
      expect(dataOf(subscriberB[0]).id).toBe('evt-fanout');
    } finally {
      await messageBus.close();
    }
  });

  it('routes multiple command types to their handlers', async () => {
    const messageBus = createMessageBus();

    const receivedA: Command[] = [];
    const receivedB: Command[] = [];

    messageBus.handle((command: Command) => {
      receivedA.push(command);

      return Promise.resolve();
    }, 'TestCommandA');

    messageBus.handle((command: Command) => {
      receivedB.push(command);

      return Promise.resolve();
    }, 'TestCommandB');

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

      expect(dataOf(receivedA[0]).id).toBe('cmd-a');
      expect(dataOf(receivedB[0]).id).toBe('cmd-b');
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

    consumer.handle((command: Command) => {
      receivedCommands.push(command);

      return Promise.resolve();
    }, 'ProducerOnlyCommand');

    consumer.subscribe((event: Event) => {
      receivedEvents.push(event);

      return Promise.resolve();
    }, 'ProducerOnlyEvent');

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

      expect(dataOf(receivedCommands[0]).id).toBe('cmd-producer');
      expect(dataOf(receivedEvents[0]).id).toBe('evt-producer');
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

    busA.subscribe((event: Event) => {
      receivedA.push(event);

      return Promise.resolve();
    }, 'SharedEvent');

    busB.subscribe((event: Event) => {
      receivedB.push(event);

      return Promise.resolve();
    }, 'SharedEvent');

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

      expect(dataOf(receivedA[0]).id).toBe('evt-shared');
      expect(dataOf(receivedB[0]).id).toBe('evt-shared');
    } finally {
      await busA.close();
      await busB.close();
    }
  });

  it('preserves metadata in event delivery', async () => {
    const messageBus = createMessageBus();
    const receivedEvents: Event[] = [];

    messageBus.subscribe((event: Event) => {
      receivedEvents.push(event);

      return Promise.resolve();
    }, 'MetadataEvent');

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

      const receivedMetadata = metadataOf(receivedEvents[0]);
      expect(receivedMetadata).toBeDefined();
      expect(receivedMetadata?.now).toBeInstanceOf(Date);
      expect((receivedMetadata?.now as Date).toISOString()).toBe(
        '2024-01-15T10:00:00.000Z',
      );
    } finally {
      await messageBus.close();
    }
  });

  describe('idle recovery', () => {
    // Dedicated container with a FIXED host port, so a `docker restart` cannot
    // land on a different ephemeral host port (Docker Desktop was observed
    // reassigning the host port across a restart when it is dynamically
    // allocated, which would otherwise be mistaken for the bug under test).
    const idleRecoveryPort = 18086;
    let idleRecoveryContainer:
      | import('testcontainers').StartedTestContainer
      | null = null;

    beforeAll(async () => {
      idleRecoveryContainer = await new GenericContainer(
        'myfstartup/firebase-emulator-suite:15',
      )
        .withPlatform('linux/amd64')
        .withExposedPorts({ container: 8085, host: idleRecoveryPort })
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

      await warmUpPubSub(
        idleRecoveryContainer.getHost(),
        idleRecoveryContainer.getMappedPort(8085),
      );
    }, 230000);

    afterAll(async () => {
      if (idleRecoveryContainer) {
        await idleRecoveryContainer.stop();
      }
    });

    it('recovers event delivery after the emulator connection is dropped and restored', async () => {
      if (!idleRecoveryContainer) {
        throw new Error('Idle-recovery emulator container was not started');
      }
      const host = idleRecoveryContainer.getHost();
      const port = idleRecoveryContainer.getMappedPort(8085);
      expect(port).toBe(idleRecoveryPort);

      const pubsub = new PubSub({
        projectId,
        apiEndpoint: `${host}:${port}`,
      });
      const messageBus = getPubSubMessageBus({
        pubsub,
        useEmulator: true,
        topicPrefix: getTopicPrefix(),
        cleanupOnClose: true,
        subscriptionOptions: {
          watchdog: { checkIntervalMs: 2000, checkTimeoutMs: 1500 },
        },
      });
      const receivedEvents: Event[] = [];

      messageBus.subscribe((event: Event) => {
        receivedEvents.push(event);

        return Promise.resolve();
      }, 'IdleRecoveryEvent');

      await messageBus.start();

      try {
        await messageBus.publish({
          type: 'IdleRecoveryEvent',
          data: { id: 'evt-before-restart', value: 'baseline' },
        });

        await waitFor(() => receivedEvents.length === 1, 10000);
        expect(dataOf(receivedEvents[0]).id).toBe('evt-before-restart');

        // Restarting the container in place (same id, same fixed port)
        // simulates the emulator's gRPC server going away and coming back
        // without ever restarting the app process - the same failure shape
        // as a NAT/idle timeout silently killing a long-lived streaming-pull
        // subscription.
        const containerId = idleRecoveryContainer.getId();
        await execFileAsync('docker', ['restart', containerId]);

        // Confirm the emulator itself is reachable again (via a throwaway
        // client) before asserting anything about the app's own subscription -
        // this isolates "the connection recovered" from "the app noticed".
        await waitFor(
          async () => {
            const probe = new PubSub({
              projectId,
              apiEndpoint: `${host}:${port}`,
            });
            try {
              await Promise.race([
                probe.getTopics(),
                new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error('probe attempt timeout')),
                    2000,
                  ),
                ),
              ]);
              return true;
            } catch {
              return false;
            } finally {
              await probe.close().catch(() => undefined);
            }
          },
          30000,
          1000,
        );

        // The restarted emulator lost every topic and subscription, and the watchdog only
        // recreates the subscription on its next tick. A message published before that lands
        // on a topic with no subscription and is gone, so keep publishing until one arrives:
        // what is asserted is that delivery recovers, not that a single publish races the tick.
        let attempt = 0;
        await waitFor(
          async () => {
            if (receivedEvents.length >= 2) {
              return true;
            }
            await messageBus.publish({
              type: 'IdleRecoveryEvent',
              data: {
                id: `evt-after-restart-${attempt++}`,
                value: 'post-restart',
              },
            });
            return false;
          },
          30000,
          1000,
        );
        expect(dataOf(receivedEvents[1]).id).toMatch(/^evt-after-restart-\d+$/);
      } finally {
        await messageBus.close();
      }
    }, 150000);
  });
});
