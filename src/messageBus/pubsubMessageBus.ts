import type {
  AnyMessage,
  Command,
  CommandProcessor,
  Event,
  EventSubscription,
  Message,
  MessageBus,
  ScheduledMessageProcessor,
  SingleMessageHandler,
  SingleRawMessageHandlerWithoutContext,
} from '@event-driven-io/emmett';
import { EmmettError } from '@event-driven-io/emmett';
import type {
  PubSubMessageBusConfig,
  PubSubMessageBusLifecycle,
  SubscriptionInfo,
} from './types';
import type { ScheduledMessage } from './scheduler';
import { MessageScheduler } from './scheduler';
import { serialize } from './serialization';
import {
  getCommandSubscriptionName,
  getCommandTopicName,
  getEventSubscriptionName,
  getEventTopicName,
  getOrCreateSubscription,
  getOrCreateTopic,
  deleteSubscriptions,
} from './topicManager';
import { createMessageListener } from './messageHandler';
import { generateUUID } from './utils';

/**
 * Determine message kind based on message type naming convention (fallback)
 *
 * @param messageType - The message type string
 * @returns 'command' if type contains 'Command', otherwise 'event'
 */
function determineMessageKindFallback(messageType: string): 'command' | 'event' {
  const typeStr = messageType.toLowerCase();
  return typeStr.includes('command') ? 'command' : 'event';
}

/**
 * Create a Google Cloud Pub/Sub based message bus for Emmett
 *
 * @param config - Configuration for the PubSub message bus
 * @returns A message bus implementation using Google Cloud Pub/Sub
 *
 * @example
 * ```typescript
 * import { PubSub } from '@google-cloud/pubsub';
 * import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';
 *
 * const pubsub = new PubSub({ projectId: 'my-project' });
 * const messageBus = getPubSubMessageBus({ pubsub });
 *
 * // Register handlers
 * messageBus.handle(async (command) => {
 *   // Handle command
 * }, 'MyCommand');
 *
 * // Subscribe to events
 * messageBus.subscribe(async (event) => {
 *   // Handle event
 * }, 'MyEvent');
 *
 * // Start the message bus
 * await messageBus.start();
 *
 * // Send commands and publish events
 * await messageBus.send({ type: 'MyCommand', data: { ... } });
 * await messageBus.publish({ type: 'MyEvent', data: { ... } });
 *
 * // Close gracefully
 * await messageBus.close();
 * ```
 */
export function getPubSubMessageBus(
  config: PubSubMessageBusConfig,
): MessageBus &
  EventSubscription &
  CommandProcessor &
  ScheduledMessageProcessor &
  PubSubMessageBusLifecycle {
  // Internal state
  const instanceId = config.instanceId ?? generateUUID();
  const topicPrefix = config.topicPrefix ?? 'emmett';
  const autoCreateResources = config.autoCreateResources ?? true;
  const cleanupOnClose = config.cleanupOnClose ?? false;
  const closePubSubClient = config.closePubSubClient;

  // Map of message type to handlers
  const handlers = new Map<
    string,
    SingleRawMessageHandlerWithoutContext<AnyMessage>[]
  >();

  // Map of subscription ID to specific handler (for event subscriptions)
  const subscriptionHandlers = new Map<
    string,
    SingleRawMessageHandlerWithoutContext<AnyMessage>
  >();

  // Map of message type to subscription IDs (for events with multiple subscriptions)
  const eventSubscriptionIds = new Map<string, string[]>();

  // Track which message types are commands vs events
  const commandTypes = new Set<string>();
  const eventTypes = new Set<string>();

  // Active subscriptions
  const subscriptions: SubscriptionInfo[] = [];

  // Scheduler for delayed messages
  const scheduler = new MessageScheduler({
    useEmulator: config.useEmulator ?? false,
    pubsub: config.pubsub,
    topicPrefix,
  });

  // Lifecycle state
  let started = false;

  /**
   * Determine message kind based on how it was registered
   *
   * @param messageType - The message type string
   * @returns 'command' if registered with handle(), 'event' if registered with subscribe()
   */
  function determineMessageKind(messageType: string): 'command' | 'event' {
    // Check explicit registration first
    if (commandTypes.has(messageType)) {
      return 'command';
    }
    if (eventTypes.has(messageType)) {
      return 'event';
    }
    // Fallback to name-based heuristic
    return determineMessageKindFallback(messageType);
  }

  /**
   * Ensure the message bus has been started before performing operations
   *
   * @throws Error if the message bus is not started
   */
  function ensureStarted(): void {
    if (!started) {
      throw new Error(
        'Message bus is not started. Call start() before sending/publishing messages.',
      );
    }
  }

  /**
   * Create subscription for a specific message type
   *
   * @param messageType - The message type
   * @param kind - Whether this is a command or event
   * @param subscriptionId - Optional subscription ID for events
   */
  async function createSubscriptionForType(
    messageType: string,
    kind: 'command' | 'event',
    subscriptionId?: string,
  ): Promise<void> {
    // Get topic name based on kind
    const topicName =
      kind === 'command'
        ? getCommandTopicName(messageType, topicPrefix)
        : getEventTopicName(messageType, topicPrefix);

    // Get or create topic
    const topic = await getOrCreateTopic(config.pubsub, topicName);

    // Get subscription name
    const subName =
      kind === 'command'
        ? getCommandSubscriptionName(messageType, instanceId, topicPrefix)
        : getEventSubscriptionName(
            messageType,
            subscriptionId ?? instanceId,
            topicPrefix,
          );

    // Create subscription
    const subscription = await getOrCreateSubscription(
      topic,
      subName,
      config.subscriptionOptions,
    );

    // Create message listener with appropriate handlers
    if (kind === 'event' && subscriptionId) {
      // For events, create a map with only this subscription's handler
      const handler = subscriptionHandlers.get(subscriptionId);
      if (handler) {
        const singleHandlerMap = new Map<
          string,
          SingleRawMessageHandlerWithoutContext<AnyMessage>[]
        >();
        singleHandlerMap.set(messageType, [handler]);
        createMessageListener(subscription, messageType, kind, singleHandlerMap);
      }
    } else {
      // For commands, use the handlers map as before
      createMessageListener(subscription, messageType, kind, handlers);
    }

    // Track subscription
    subscriptions.push({
      topic,
      subscription,
      messageType,
      kind,
    });
  }

  /**
   * Publish a message to a PubSub topic
   *
   * @param message - The message to publish
   * @param kind - Whether this is a command or event
   */
  async function publishMessage(
    message: Message,
    kind: 'command' | 'event',
  ): Promise<void> {
    ensureStarted();

    // Get topic name
    const topicName =
      kind === 'command'
        ? getCommandTopicName(message.type, topicPrefix)
        : getEventTopicName(message.type, topicPrefix);

    try {
      // Get topic
      const topic = config.pubsub.topic(topicName);

      // Check if topic exists if auto-create is disabled
      if (!autoCreateResources) {
        const [exists] = await topic.exists();
        if (!exists) {
          throw new Error(
            `Topic ${topicName} does not exist and autoCreateResources is disabled`,
          );
        }
      } else {
        // Create topic if it doesn't exist
        const [exists] = await topic.exists();
        if (!exists) {
          await topic.create();
        }
      }

      // Serialize message
      const buffer = serialize(message);

      // Publish
      await topic.publishMessage({
        data: buffer,
        attributes: {
          messageType: message.type,
          messageKind: kind,
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to publish ${kind} ${message.type} to topic ${topicName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Return the message bus implementation
  return {
    // ===== MessageBus Interface =====

    /**
     * Send a command to the message bus
     *
     * Commands are routed to exactly one handler via PubSub topics
     *
     * @param command - The command to send
     */
    async send<CommandType extends Command>(
      command: CommandType,
    ): Promise<void> {
      await publishMessage(command, 'command');
    },

    /**
     * Publish an event to the message bus
     *
     * Events are delivered to all registered subscribers via PubSub topics
     *
     * @param event - The event to publish
     */
    async publish<EventType extends Event>(event: EventType): Promise<void> {
      await publishMessage(event, 'event');
    },

    /**
     * Schedule a message for future delivery
     *
     * In production mode: Uses PubSub native scheduling
     * In emulator mode: Stores in memory (emulator doesn't support scheduling)
     *
     * @param message - The message to schedule
     * @param when - When to deliver the message (afterInMs or at)
     */
    schedule<MessageType extends Message>(
      message: MessageType,
      when?: { afterInMs: number } | { at: Date },
    ): void {
      scheduler.schedule(message, when);
    },

    // ===== CommandProcessor Interface =====

    /**
     * Register a command handler
     *
     * Commands must have exactly one handler. Attempting to register multiple
     * handlers for the same command will throw an EmmettError.
     *
     * @param commandHandler - The handler function
     * @param commandTypes - Command types this handler processes
     * @throws EmmettError if a handler is already registered for any command type
     *
     * @example
     * ```typescript
     * messageBus.handle(
     *   async (command: AddProductItemCommand) => {
     *     // Handle command
     *   },
     *   'AddProductItem'
     * );
     * ```
     */
    handle<CommandType extends Command>(
      commandHandler: SingleMessageHandler<CommandType>,
      ...commandTypeNames: CommandType['type'][]
    ): void {
      for (const commandType of commandTypeNames) {
        // Validate no duplicate handlers
        if (handlers.has(commandType)) {
          throw new EmmettError(
            `Handler already registered for command ${commandType}. ` +
              `Commands must have exactly one handler.`,
          );
        }

        // Track as command type
        commandTypes.add(commandType);

        // Store handler (single handler in array for consistency)
        handlers.set(commandType, [
          commandHandler as SingleRawMessageHandlerWithoutContext<AnyMessage>,
        ]);

        // If already started, create subscription immediately
        if (started) {
          createSubscriptionForType(commandType, 'command').catch((error) => {
            console.error(
              `Failed to create subscription for command ${commandType}:`,
              error instanceof Error ? error.message : String(error),
            );
          });
        }
      }
    },

    // ===== EventSubscription Interface =====

    /**
     * Subscribe to events
     *
     * Events can have multiple subscribers. Each subscription gets its own
     * PubSub subscription to ensure all handlers receive all events.
     *
     * @param eventHandler - The handler function
     * @param eventTypes - Event types to subscribe to
     *
     * @example
     * ```typescript
     * messageBus.subscribe(
     *   async (event: ProductItemAddedEvent) => {
     *     // Handle event
     *   },
     *   'ProductItemAdded'
     * );
     * ```
     */
    subscribe<EventType extends Event>(
      eventHandler: SingleMessageHandler<EventType>,
      ...eventTypeNames: EventType['type'][]
    ): void {
      for (const eventType of eventTypeNames) {
        // Track as event type
        eventTypes.add(eventType);

        // Generate unique subscription ID for this subscriber
        const subscriptionId = generateUUID();

        // Store handler associated with this subscription ID
        subscriptionHandlers.set(
          subscriptionId,
          eventHandler as SingleRawMessageHandlerWithoutContext<AnyMessage>,
        );

        // Get existing handlers or create new array
        const existing = handlers.get(eventType) ?? [];

        // Add handler to array (for compatibility)
        handlers.set(eventType, [
          ...existing,
          eventHandler as SingleRawMessageHandlerWithoutContext<AnyMessage>,
        ]);

        // Track subscription ID for this event type
        const existingIds = eventSubscriptionIds.get(eventType) ?? [];
        eventSubscriptionIds.set(eventType, [...existingIds, subscriptionId]);

        // If already started, create subscription immediately
        if (started) {
          createSubscriptionForType(eventType, 'event', subscriptionId).catch(
            (error) => {
              console.error(
                `Failed to create subscription for event ${eventType}:`,
                error instanceof Error ? error.message : String(error),
              );
            },
          );
        }
      }
    },

    // ===== ScheduledMessageProcessor Interface =====

    /**
     * Dequeue scheduled messages that are ready for delivery
     *
     * Only used in emulator mode. In production, PubSub handles scheduling.
     *
     * @returns Array of scheduled messages ready for delivery
     *
     * @example
     * ```typescript
     * // In emulator mode, periodically call dequeue
     * setInterval(() => {
     *   const ready = messageBus.dequeue();
     *   for (const { message } of ready) {
     *     // Process message
     *   }
     * }, 1000);
     * ```
     */
    dequeue(): ScheduledMessage[] {
      return scheduler.dequeue();
    },

    // ===== PubSubMessageBusLifecycle Interface =====

    /**
     * Start the message bus
     *
     * Creates topics and subscriptions for all registered handlers and begins
     * listening for messages.
     *
     * This method is idempotent - calling it multiple times is safe.
     *
     * @throws Error if topic/subscription creation fails
     *
     * @example
     * ```typescript
     * // Register all handlers first
     * messageBus.handle(commandHandler, 'MyCommand');
     * messageBus.subscribe(eventHandler, 'MyEvent');
     *
     * // Then start
     * await messageBus.start();
     * ```
     */
    async start(): Promise<void> {
      if (started) {
        console.debug('Message bus already started, skipping');
        return;
      }

      console.info('Starting PubSub message bus...');

      try {
        // Create subscriptions for all registered handlers
        const subscriptionPromises: Promise<void>[] = [];

        for (const [messageType] of handlers.entries()) {
          const kind = determineMessageKind(messageType);

          if (kind === 'command') {
            // Commands: one subscription per instance
            subscriptionPromises.push(
              createSubscriptionForType(messageType, 'command'),
            );
          } else {
            // Events: one subscription per handler (multiple allowed)
            const subIds = eventSubscriptionIds.get(messageType) ?? [
              instanceId,
            ];
            for (const subId of subIds) {
              subscriptionPromises.push(
                createSubscriptionForType(messageType, 'event', subId),
              );
            }
          }
        }

        // Wait for all subscriptions to be created
        await Promise.all(subscriptionPromises);

        started = true;

        console.info(
          `PubSub message bus started with ${subscriptions.length} subscription(s)`,
        );
      } catch (error) {
        throw new Error(
          `Failed to start message bus: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },

    /**
     * Close the message bus gracefully
     *
     * Stops accepting new messages, waits for in-flight messages to complete,
     * optionally cleans up subscriptions, and closes the PubSub client.
     *
     * @throws Error if cleanup fails
     *
     * @example
     * ```typescript
     * // Graceful shutdown
     * process.on('SIGTERM', async () => {
     *   await messageBus.close();
     *   process.exit(0);
     * });
     * ```
     */
    async close(): Promise<void> {
      if (!started) {
        console.debug('Message bus not started, skipping close');
        return;
      }

      console.info('Closing PubSub message bus...');

      try {
        // Stop accepting new messages
        for (const { subscription } of subscriptions) {
          subscription.removeAllListeners('message');
          subscription.removeAllListeners('error');
        }

        // Wait for in-flight messages with timeout (30 seconds)
        const timeout = 30000;
        const waitStart = Date.now();

        // Close all subscriptions
        const closePromises = subscriptions.map(({ subscription }) =>
          subscription.close(),
        );
        await Promise.race([
          Promise.all(closePromises),
          new Promise((resolve) => setTimeout(resolve, timeout)),
        ]);

        const waitTime = Date.now() - waitStart;
        if (waitTime >= timeout) {
          console.warn(
            `Timeout waiting for in-flight messages after ${timeout}ms`,
          );
        }

        // Cleanup subscriptions if configured
        if (cleanupOnClose) {
          console.info('Cleaning up subscriptions...');
          await deleteSubscriptions(subscriptions.map((s) => s.subscription));
        }

        // Close PubSub client if configured
        if (closePubSubClient !== false) {
          await config.pubsub.close();
        }

        started = false;

        console.info('PubSub message bus closed');
      } catch (error) {
        throw new Error(
          `Failed to close message bus: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    },

    /**
     * Check if the message bus is started
     *
     * @returns true if the message bus is started and ready to process messages
     */
    isStarted(): boolean {
      return started;
    },
  };
}
