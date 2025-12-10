import type { PubSub, Subscription, Topic } from '@google-cloud/pubsub';
import type { SubscriptionOptions } from './types';

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
 * @returns The topic instance
 */
export async function getOrCreateTopic(
  pubsub: PubSub,
  topicName: string,
): Promise<Topic> {
  const topic = pubsub.topic(topicName);

  try {
    const [exists] = await topic.exists();

    if (!exists) {
      try {
        await topic.create();
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
): Promise<Subscription> {
  const subscription = topic.subscription(subscriptionName);

  try {
    const [exists] = await subscription.exists();

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
        await subscription.create(config);
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
 */
export async function deleteSubscription(
  subscription: Subscription,
): Promise<void> {
  try {
    const [exists] = await subscription.exists();

    if (exists) {
      await subscription.delete();
    }
  } catch (error) {
    // Log but don't throw - cleanup is best effort
    console.warn(
      `Failed to delete subscription: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Delete multiple subscriptions
 *
 * @param subscriptions - Array of subscriptions to delete
 */
export async function deleteSubscriptions(
  subscriptions: Subscription[],
): Promise<void> {
  await Promise.all(subscriptions.map((sub) => deleteSubscription(sub)));
}
