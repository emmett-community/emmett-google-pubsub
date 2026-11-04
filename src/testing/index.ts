// Test support: import from '@emmett-community/emmett-google-pubsub/testing'
import type { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '../messageBus/pubsubMessageBus';
import type { PubSubMessageBusConfig } from '../messageBus/types';
import { generateUUID } from '../messageBus/utils';
import { InMemoryPubSub } from './inMemoryPubSub';

export { InMemoryPubSub } from './inMemoryPubSub';

/**
 * Message bus on an in-memory Pub/Sub, with a unique topic prefix per call and the liveness
 * watchdog off (the fake has no subscription metadata). Pass the same `pubsub` and `topicPrefix`
 * to several calls to model several services or replicas on one project.
 */
export function createInMemoryMessageBus(
  config?: Partial<Omit<PubSubMessageBusConfig, 'pubsub'>> & { pubsub?: InMemoryPubSub },
) {
  const { pubsub = new InMemoryPubSub(), subscriptionOptions, ...rest } = config ?? {};

  return getPubSubMessageBus({
    useEmulator: true,
    cleanupOnClose: true,
    closePubSubClient: false,
    topicPrefix: `test-${generateUUID()}`,
    ...rest,
    pubsub: pubsub as unknown as PubSub,
    subscriptionOptions: { watchdog: { enabled: false }, ...subscriptionOptions },
  });
}
