import { PubSub } from '@google-cloud/pubsub';
import type { Command, Event } from '@event-driven-io/emmett';
import { getPubSubMessageBus } from '../../src/messageBus/pubsubMessageBus';
import type { PubSubMessageBusConfig } from '../../src/messageBus/types';
import { generateUUID } from '../../src/messageBus/utils';

/**
 * Create a PubSub client configured for the emulator
 */
export function getTestPubSub(): PubSub {
  const projectId = process.env.PUBSUB_PROJECT_ID || 'test-project';
  const emulatorHost = process.env.PUBSUB_EMULATOR_HOST || 'localhost:8085';

  return new PubSub({
    projectId,
    apiEndpoint: emulatorHost,
  });
}

/**
 * Create a test message bus with emulator configuration
 */
export function getTestMessageBus(
  config?: Partial<PubSubMessageBusConfig>,
) {
  const pubsub = getTestPubSub();

  return getPubSubMessageBus({
    pubsub,
    useEmulator: true,
    cleanupOnClose: true,
    closePubSubClient: false, // Don't close client to allow restart in tests
    topicPrefix: `test-${generateUUID()}`, // Unique prefix per test using UUID
    ...config,
  });
}

/**
 * Wait for a condition to be true with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

/**
 * Wait for a specific amount of time
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sample command type for testing
 */
export type TestCommand = Command<
  'TestCommand',
  {
    id: string;
    value: string;
  }
>;

/**
 * Sample event type for testing
 */
export type TestEvent = Event<
  'TestEvent',
  {
    id: string;
    value: string;
    timestamp: Date;
  }
>;

/**
 * Create a test command
 */
export function createTestCommand(id: string, value: string): TestCommand {
  return {
    type: 'TestCommand',
    data: { id, value },
  };
}

/**
 * Create a test event
 */
export function createTestEvent(
  id: string,
  value: string,
  timestamp = new Date(),
): TestEvent {
  return {
    type: 'TestEvent',
    data: { id, value, timestamp },
  };
}
