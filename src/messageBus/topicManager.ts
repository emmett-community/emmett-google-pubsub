import type { PubSub, Subscription, Topic } from '@google-cloud/pubsub';
import type { Logger, SubscriptionOptions } from './types';
import { safeLog } from './observability';

const DEFAULT_SETUP_TIMEOUT_MS = 10000;

/**
 * Bounds a PubSub client call that would otherwise have no timeout of its
 * own. A gRPC call issued on a connection that went silently dead (e.g.
 * after a network interruption) can hang indefinitely rather than
 * rejecting - without this, resource setup during `start()` could block
 * the entire message bus (and anything awaiting it) forever.
 */
const withSetupTimeout = <T>(promise: Promise<T>, operation: string, timeoutMs: number): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`${operation} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
      timeoutHandle.unref?.();
    }),
  ]).finally(() => clearTimeout(timeoutHandle));
};

/**
 * Get command topic name
 */
export function getCommandTopicName(
  commandType: string,
  prefix = 'emmett',
): string {
  return `${prefix}-cmd-${commandType}`;
}

/**
 * Get event topic name
 */
export function getEventTopicName(eventType: string, prefix = 'emmett'): string {
  return `${prefix}-evt-${eventType}`;
}

/**
 * Get command subscription name
 */
export function getCommandSubscriptionName(
  commandType: string,
  instanceId: string,
  prefix = 'emmett',
): string {
  return `${prefix}-cmd-${commandType}-${instanceId}`;
}

/**
 * Get event subscription name
 */
export function getEventSubscriptionName(
  eventType: string,
  subscriptionId: string,
  prefix = 'emmett',
): string {
  return `${prefix}-evt-${eventType}-${subscriptionId}`;
}

/**
 * Get or create a topic
 *
 * @param pubsub - PubSub client
 * @param topicName - Name of the topic
 * @param timeoutMs - Maximum time to wait for each underlying call
 * @returns The topic instance
 */
export async function getOrCreateTopic(
  pubsub: PubSub,
  topicName: string,
  timeoutMs = DEFAULT_SETUP_TIMEOUT_MS,
): Promise<Topic> {
  const topic = pubsub.topic(topicName);

  try {
    const [exists] = await withSetupTimeout(topic.exists(), `Checking topic ${topicName} exists`, timeoutMs);

    if (!exists) {
      try {
        await withSetupTimeout(topic.create(), `Creating topic ${topicName}`, timeoutMs);
      } catch (createError: any) {
        // Ignore ALREADY_EXISTS errors (race condition)
        if (createError.code !== 6) {
          throw createError;
        }
      }
    }

    return topic;
  } catch (error) {
    throw new Error(
      `Failed to get or create topic ${topicName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get or create a subscription
 *
 * @param topic - The topic to subscribe to
 * @param subscriptionName - Name of the subscription
 * @param options - Subscription options
 * @returns The subscription instance
 */
export async function getOrCreateSubscription(
  topic: Topic,
  subscriptionName: string,
  options?: SubscriptionOptions,
  timeoutMs = DEFAULT_SETUP_TIMEOUT_MS,
): Promise<Subscription> {
  const subscription = topic.subscription(subscriptionName);

  try {
    const [exists] = await withSetupTimeout(
      subscription.exists(),
      `Checking subscription ${subscriptionName} exists`,
      timeoutMs,
    );

    if (!exists) {
      const config = {
        ...(options?.ackDeadlineSeconds && {
          ackDeadlineSeconds: options.ackDeadlineSeconds,
        }),
        ...(options?.retryPolicy && {
          retryPolicy: {
            ...(options.retryPolicy.minimumBackoff && {
              minimumBackoff: options.retryPolicy.minimumBackoff,
            }),
            ...(options.retryPolicy.maximumBackoff && {
              maximumBackoff: options.retryPolicy.maximumBackoff,
            }),
          },
        }),
        ...(options?.deadLetterPolicy && {
          deadLetterPolicy: {
            ...(options.deadLetterPolicy.deadLetterTopic && {
              deadLetterTopic: options.deadLetterPolicy.deadLetterTopic,
            }),
            ...(options.deadLetterPolicy.maxDeliveryAttempts && {
              maxDeliveryAttempts: options.deadLetterPolicy.maxDeliveryAttempts,
            }),
          },
        }),
      };

      try {
        await withSetupTimeout(
          subscription.create(config),
          `Creating subscription ${subscriptionName}`,
          timeoutMs,
        );
      } catch (createError: any) {
        // Ignore ALREADY_EXISTS errors (race condition)
        if (createError.code !== 6) {
          throw createError;
        }
      }
    }

    return subscription;
  } catch (error) {
    throw new Error(
      `Failed to get or create subscription ${subscriptionName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Delete a subscription
 *
 * @param subscription - The subscription to delete
 * @param logger - Optional logger for observability
 */
export async function deleteSubscription(
  subscription: Subscription,
  logger?: Logger,
): Promise<void> {
  try {
    const [exists] = await subscription.exists();

    if (exists) {
      await subscription.delete();
    }
  } catch (error) {
    // Log but don't throw - cleanup is best effort
    safeLog.warn(logger, 'Failed to delete subscription', error);
  }
}

/**
 * Delete multiple subscriptions
 *
 * @param subscriptions - Array of subscriptions to delete
 * @param logger - Optional logger for observability
 */
export async function deleteSubscriptions(
  subscriptions: Subscription[],
  logger?: Logger,
): Promise<void> {
  await Promise.all(subscriptions.map((sub) => deleteSubscription(sub, logger)));
}
