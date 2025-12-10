import type { PubSub, Subscription, Topic } from '@google-cloud/pubsub';
import type { Message, SingleMessageHandler } from '@event-driven-io/emmett';

/**
 * Configuration for PubSub MessageBus
 */
export interface PubSubMessageBusConfig {
  /**
   * Google Cloud PubSub client instance
   */
  pubsub: PubSub;

  /**
   * Instance identifier for subscriptions (auto-generated if not provided)
   */
  instanceId?: string;

  /**
   * Topic/subscription name prefix
   * @default "emmett"
   */
  topicPrefix?: string;

  /**
   * Enable emulator mode (disables Cloud Scheduler features)
   * @default false
   */
  useEmulator?: boolean;

  /**
   * Subscription configuration options
   */
  subscriptionOptions?: SubscriptionOptions;

  /**
   * Auto-create topics/subscriptions
   * @default true
   */
  autoCreateResources?: boolean;

  /**
   * Cleanup subscriptions on close
   * @default false
   */
  cleanupOnClose?: boolean;

  /**
   * Close the PubSub client on close
   * Set to false if you want to reuse the client (e.g., in tests)
   * @default true
   */
  closePubSubClient?: boolean;
}

/**
 * Subscription configuration options
 */
export interface SubscriptionOptions {
  /**
   * Acknowledgment deadline in seconds
   * @default 60
   */
  ackDeadlineSeconds?: number;

  /**
   * Retry policy for failed messages
   */
  retryPolicy?: {
    minimumBackoff?: { seconds: number };
    maximumBackoff?: { seconds: number };
  };

  /**
   * Dead letter policy
   */
  deadLetterPolicy?: {
    deadLetterTopic?: string;
    maxDeliveryAttempts?: number;
  };
}

/**
 * Message envelope for PubSub transport
 */
export interface PubSubMessageEnvelope {
  /**
   * Message type (e.g., "AddProductItem")
   */
  type: string;

  /**
   * Message kind (command or event)
   */
  kind: 'command' | 'event';

  /**
   * Serialized message data
   */
  data: unknown;

  /**
   * Serialized message metadata
   */
  metadata?: unknown;

  /**
   * ISO 8601 timestamp
   */
  timestamp: string;

  /**
   * UUID for idempotency
   */
  messageId: string;
}

/**
 * Internal handler registration
 */
export interface HandlerRegistration<T extends Message = Message> {
  id: string;
  handler: SingleMessageHandler<T>;
}

/**
 * Subscription information
 */
export interface SubscriptionInfo {
  topic: Topic;
  subscription: Subscription;
  messageType: string;
  kind: 'command' | 'event';
}

/**
 * Scheduled message with timing information
 */
export interface ScheduledMessageInfo {
  message: Message;
  options?: { afterInMs: number } | { at: Date };
  scheduledAt: Date;
}

/**
 * PubSub message bus lifecycle
 */
export interface PubSubMessageBusLifecycle {
  /**
   * Start the message bus (create topics/subscriptions and start listening)
   */
  start(): Promise<void>;

  /**
   * Close the message bus gracefully
   */
  close(): Promise<void>;

  /**
   * Check if the message bus is started
   */
  isStarted(): boolean;
}
