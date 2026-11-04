import type { Subscription, Topic } from '@google-cloud/pubsub';
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
import { trace, SpanStatusCode } from '@opentelemetry/api';
import type {
  Logger,
  PubSubMessageBusConfig,
  PubSubMessageBusLifecycle,
  PubSubMessageBusSubscriptions,
  SubscribeOptions,
  SubscriptionInfo,
  SubscriptionOptions,
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
import { createMessageListener, startSubscriptionWatchdog } from './messageHandler';
import { generateUUID } from './utils';
import { safeLog } from './observability';
import { toTraceparent } from './tracing';

const tracer = trace.getTracer('@emmett-community/emmett-google-pubsub');

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
  PubSubMessageBusSubscriptions &
  PubSubMessageBusLifecycle {
  // Extract observability options
  const logger: Logger | undefined = config.observability?.logger;

  // Internal state
  const instanceId = config.instanceId ?? generateUUID();
  const defaultSubscriptionId = config.subscriptionId;
  let warnedEphemeral = false;

  // Without a subscription id an event subscription is named after a random id: every restart
  // leaves an orphan subscription behind and loses the events published while down
  function warnEphemeralSubscriptions(): void {
    if (warnedEphemeral || config.useEmulator) return;
    warnedEphemeral = true;
    safeLog.warn(
      logger,
      'No subscriptionId configured: event subscriptions are ephemeral (random id per subscriber)',
    );
  }
  const topicPrefix = config.topicPrefix ?? 'emmett';
  const autoCreateResources = config.autoCreateResources ?? true;
  const cleanupOnClose = config.cleanupOnClose ?? false;
  const closePubSubClient = config.closePubSubClient;

  // Map of message type to handlers
  const handlers = new Map<
    string,
    SingleRawMessageHandlerWithoutContext<AnyMessage>[]
  >();

  // Handlers of each event subscription, by subscription ID and then message type. Several
  // handlers can share one subscription (those of one service); the array is mutated in
  // place so a listener that is already running sees handlers registered later.
  const subscriptionHandlers = new Map<
    string,
    Map<string, SingleRawMessageHandlerWithoutContext<AnyMessage>[]>
  >();

  // Map of message type to subscription IDs (for events with multiple subscriptions)
  const eventSubscriptionIds = new Map<string, string[]>();

  // Per-subscriber options registered through subscribeWithOptions, by `<subscription ID>|<type>`
  const subscriptionSettings = new Map<string, SubscribeOptions>();

  // Event subscriptions already opened, by `<subscription ID>|<type>`
  const openedEventSubscriptions = new Set<string>();

  const subscriptionKey = (subscriptionId: string, messageType: string) =>
    `${subscriptionId}|${messageType}`;

  // Track which message types are commands vs events
  const commandTypes = new Set<string>();
  const eventTypes = new Set<string>();

  // Active subscriptions
  const subscriptions: SubscriptionInfo[] = [];

  // Stop functions for each subscription's liveness watchdog
  const watchdogStoppers: (() => void)[] = [];

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
    if (kind === 'event' && subscriptionId) {
      // One Pub/Sub subscription per (id, type), however many handlers share it
      const key = subscriptionKey(subscriptionId, messageType);
      if (openedEventSubscriptions.has(key)) {
        return;
      }
      openedEventSubscriptions.add(key);
    }

    const settings = subscriptionId
      ? subscriptionSettings.get(subscriptionKey(subscriptionId, messageType))
      : undefined;

    // Get topic name based on kind (a subscriber may read events published under another prefix)
    const topicName =
      kind === 'command'
        ? getCommandTopicName(messageType, topicPrefix)
        : getEventTopicName(messageType, settings?.topicPrefix ?? topicPrefix);

    const subscriptionOptions: SubscriptionOptions | undefined =
      settings?.deadLetterPolicy || settings?.retryPolicy
        ? {
            ...config.subscriptionOptions,
            ...(settings.deadLetterPolicy && { deadLetterPolicy: settings.deadLetterPolicy }),
            ...(settings.retryPolicy && { retryPolicy: settings.retryPolicy }),
          }
        : config.subscriptionOptions;

    // Get subscription name
    const subName =
      kind === 'command'
        ? getCommandSubscriptionName(messageType, instanceId, topicPrefix)
        : getEventSubscriptionName(
            messageType,
            subscriptionId ?? instanceId,
            topicPrefix,
          );

    // Handlers this subscription's listener should route to, resolved once
    // up front so a later recreation (by the watchdog) routes to the same
    // handlers as the original subscription did.
    const handlersForListener = (() => {
      if (kind === 'event' && subscriptionId) {
        const registered = subscriptionHandlers.get(subscriptionId)?.get(messageType);
        const handlersOfSubscription = new Map<
          string,
          SingleRawMessageHandlerWithoutContext<AnyMessage>[]
        >();
        if (registered) {
          handlersOfSubscription.set(messageType, registered);
        }
        return handlersOfSubscription;
      }
      return handlers;
    })();

    // Re-verifies (and recreates if missing) the topic on every call, not
    // just the first - a cached `Topic` reference can outlive the resource
    // it points to, and recreating a subscription onto a topic that no
    // longer exists fails.
    const setupTimeoutMs = config.subscriptionOptions?.setupTimeoutMs;
    const openSubscription = async (): Promise<{
      topic: Topic;
      subscription: Subscription;
    }> => {
      const topic = await getOrCreateTopic(config.pubsub, topicName, setupTimeoutMs);
      const subscription = await getOrCreateSubscription(
        topic,
        subName,
        subscriptionOptions,
        setupTimeoutMs,
        config.pubsub,
      );
      createMessageListener(subscription, messageType, kind, handlersForListener, logger);
      return { topic, subscription };
    };

    const opened = await openSubscription();

    // Track subscription (mutated in place if the watchdog recreates it, so
    // close() and any other reader always sees the currently-live instance)
    const info: SubscriptionInfo = {
      topic: opened.topic,
      subscription: opened.subscription,
      messageType,
      kind,
    };
    subscriptions.push(info);

    const stopWatchdog = startSubscriptionWatchdog(
      () => info.subscription,
      async () => {
        await info.subscription.close().catch(() => undefined);
        const reopened = await openSubscription();
        info.topic = reopened.topic;
        info.subscription = reopened.subscription;
        return info.subscription;
      },
      config.subscriptionOptions?.watchdog,
      logger,
    );
    watchdogStoppers.push(stopWatchdog);
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
    const spanName = kind === 'command'
      ? 'emmett.pubsub.send_command'
      : 'emmett.pubsub.publish_event';

    const span = tracer.startSpan(spanName, {
      attributes: { 'emmett.message.kind': kind },
    });

    try {
      // Publishing without start() is allowed (producer-only mode)
      // start() is only required for consumers (handlers/subscribers)

      // Get topic name
      const topicName =
        kind === 'command'
          ? getCommandTopicName(message.type, topicPrefix)
          : getEventTopicName(message.type, topicPrefix);

      safeLog.debug(logger, 'Publishing message');

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
          try {
            await topic.create();
          } catch (createError) {
            // ALREADY_EXISTS (code 6): another publisher created it between the check and now
            if ((createError as { code?: number }).code !== 6) {
              throw createError;
            }
          }
        }
      }

      // Keep the id the message already has (e.g. from the event store) so it is stable
      // across publications; consumers deduplicate by it
      const metadata = (message as { metadata?: Record<string, unknown> }).metadata;
      const messageId =
        typeof metadata?.messageId === 'string' ? metadata.messageId : generateUUID();
      const schemaVersion = metadata?.schemaVersion;
      const traceparent = toTraceparent(span.spanContext());

      // Serialize message
      const buffer = serialize(message, messageId);

      // Publish
      await topic.publishMessage({
        data: buffer,
        attributes: {
          messageType: message.type,
          messageKind: kind,
          messageId,
          ...(schemaVersion !== undefined && { schemaVersion: String(schemaVersion) }),
          ...(traceparent && { traceparent }),
        },
      });

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      safeLog.error(logger, 'Failed to publish message', error);
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Register an event handler, creating its Pub/Sub subscription right away if already started
   */
  function registerEventSubscriber<EventType extends Event>(
    eventHandler: SingleMessageHandler<EventType>,
    eventTypeNames: EventType['type'][],
    settings?: SubscribeOptions,
  ): void {
    const explicitId = settings?.subscriptionId;
    const rawHandler = eventHandler as SingleRawMessageHandlerWithoutContext<AnyMessage>;

    if (explicitId) {
      const taken = eventTypeNames.find((t) => subscriptionHandlers.get(explicitId)?.has(t));
      if (taken) {
        throw new EmmettError(
          `Subscription id ${explicitId} is already registered for ${taken}. ` +
            `Each handler needs its own id.`,
        );
      }
    }

    if (!explicitId && !settings?.fanOut && !defaultSubscriptionId) {
      warnEphemeralSubscriptions();
    }

    for (const eventType of eventTypeNames) {
      // Track as event type
      eventTypes.add(eventType);

      // Explicit id, else the bus subscription id (shared by every handler and replica of the
      // service), else a unique one for this subscriber: fan-out, or no group configured
      const subscriptionId =
        explicitId ??
        (settings?.fanOut ? undefined : defaultSubscriptionId) ??
        generateUUID();

      // Store handler associated with this subscription ID and type
      const byType =
        subscriptionHandlers.get(subscriptionId) ??
        new Map<string, SingleRawMessageHandlerWithoutContext<AnyMessage>[]>();
      const handlersOfType = byType.get(eventType) ?? [];
      handlersOfType.push(rawHandler); // in place: a running listener holds this array
      byType.set(eventType, handlersOfType);
      subscriptionHandlers.set(subscriptionId, byType);
      if (settings) {
        subscriptionSettings.set(subscriptionKey(subscriptionId, eventType), settings);
      }

      // Get existing handlers or create new array
      const existing = handlers.get(eventType) ?? [];

      // Add handler to array (for compatibility)
      handlers.set(eventType, [...existing, rawHandler]);

      // Track subscription ID for this event type
      const existingIds = eventSubscriptionIds.get(eventType) ?? [];
      if (!existingIds.includes(subscriptionId)) {
        eventSubscriptionIds.set(eventType, [...existingIds, subscriptionId]);
      }

      // If already started, create subscription immediately
      if (started) {
        createSubscriptionForType(eventType, 'event', subscriptionId).catch((error) => {
          safeLog.error(logger, 'Failed to create subscription', error);
        });
      }
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
     * In emulator mode the message is kept in memory until `dequeue` returns it, and a restart
     * loses it. Against real Pub/Sub it is published at once to the
     * `<topicPrefix>-scheduled-messages` topic with a `publishTime` attribute, but Pub/Sub has
     * no delayed delivery and nothing here consumes that topic, so the message is never
     * delivered at the requested time. A publish failure is logged, not thrown. Use
     * Cloud Scheduler and Cloud Tasks for time-based work.
     *
     * @deprecated Does not deliver on time against real Pub/Sub; see above.
     *
     * @param message - The message to schedule
     * @param when - When to deliver the message (afterInMs or at)
     */
    schedule<MessageType extends Message>(
      message: MessageType,
      when?: { afterInMs: number } | { at: Date },
    ): void {
      // `schedule` returns void in the Emmett interface, so a failure is logged, not thrown
      scheduler.schedule(message, when).catch((error) => {
        safeLog.error(logger, 'Failed to schedule message', error);
      });
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
            safeLog.error(logger, 'Failed to create subscription', error);
          });
        }
      }
    },

    // ===== EventSubscription Interface =====

    /**
     * Subscribe to events
     *
     * With a bus `subscriptionId` configured, the subscription is named after it: it survives
     * restarts (events published while the service was down are delivered), replicas of the
     * service share it so an event normally goes to one of them (Pub/Sub can deliver it again, so
     * handlers must be idempotent), and every handler of the
     * service for the same event type runs on it.
     *
     * Without a bus `subscriptionId` each subscriber gets its own subscription with a random id,
     * so all of them receive all events but nothing survives a restart. Use that only for
     * tests and local development.
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
      registerEventSubscriber(eventHandler, eventTypeNames);
    },

    /**
     * Subscribe to events with per-subscriber options
     *
     * For the uncommon cases `subscribe` does not cover: a subscription id other than the
     * bus one, `fanOut` (every replica receives every event, for example to keep an
     * in-memory cache current), a topic prefix of its own, and dead letter and retry policies
     * for this subscriber only.
     *
     * @param eventHandler - The handler function
     * @param eventTypeNames - Event types to subscribe to
     * @param options - Subscriber options
     * @throws EmmettError if the subscription id is already registered for one of the types
     *
     * @example
     * ```typescript
     * messageBus.subscribeWithOptions(refreshCache, ['PantryItemAdded'], { fanOut: true });
     *
     * messageBus.subscribeWithOptions(handler, ['PantryItemAdded'], {
     *   topicPrefix: 'pantry',
     *   deadLetterPolicy: { deadLetterTopic: 'shopping-list-dlq', maxDeliveryAttempts: 5 },
     * });
     * ```
     */
    subscribeWithOptions<EventType extends Event>(
      eventHandler: SingleMessageHandler<EventType>,
      eventTypeNames: EventType['type'][],
      options: SubscribeOptions,
    ): void {
      registerEventSubscriber(eventHandler, eventTypeNames, options);
    },

    // ===== ScheduledMessageProcessor Interface =====

    /**
     * Dequeue scheduled messages that are ready for delivery
     *
     * Returns what `schedule` kept in memory in emulator mode, and always an empty list against
     * real Pub/Sub.
     *
     * @deprecated Does not deliver on time against real Pub/Sub; see `schedule`.
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
      return tracer.startActiveSpan('emmett.pubsub.start', async (span) => {
        try {
          if (started) {
            safeLog.debug(logger, 'Message bus already started');
            span.setStatus({ code: SpanStatusCode.OK });
            return;
          }

          safeLog.info(logger, 'Starting message bus');

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

          safeLog.info(logger, 'Message bus started');
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw new Error(
            `Failed to start message bus: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          span.end();
        }
      });
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
      return tracer.startActiveSpan('emmett.pubsub.close', async (span) => {
        try {
          safeLog.info(logger, 'Closing message bus');

          // Stop all subscription watchdogs before touching subscriptions,
          // so a watchdog cannot recreate a subscription mid-shutdown.
          for (const stopWatchdog of watchdogStoppers) {
            stopWatchdog();
          }
          watchdogStoppers.length = 0;

          // Only cleanup subscriptions if started
          if (started) {
            // Stop accepting new messages
            for (const { subscription } of subscriptions) {
              subscription.removeAllListeners('message');
              subscription.removeAllListeners('error');
            }

            // Wait for in-flight messages with timeout (30 seconds)
            const timeout = 30000;
            const waitStart = Date.now();
            let timeoutId: NodeJS.Timeout | null = null;

            // Close all subscriptions
            const closePromises = subscriptions.map(({ subscription }) =>
              subscription.close(),
            );
            try {
              await Promise.race([
                Promise.all(closePromises),
                new Promise((resolve) => {
                  timeoutId = setTimeout(resolve, timeout);
                }),
              ]);
            } finally {
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
            }

            const waitTime = Date.now() - waitStart;
            if (waitTime >= timeout) {
              safeLog.warn(logger, 'Timeout waiting for in-flight messages');
            }

            // Cleanup subscriptions if configured
            if (cleanupOnClose) {
              safeLog.debug(logger, 'Cleaning up subscriptions');
              await deleteSubscriptions(subscriptions.map((s) => s.subscription), logger);
            }

            started = false;
          }

          // Always close PubSub client (even if not started, for producer-only mode)
          if (closePubSubClient !== false) {
            await config.pubsub.close();
          }

          safeLog.info(logger, 'Message bus closed');
          span.setStatus({ code: SpanStatusCode.OK });
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw new Error(
            `Failed to close message bus: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          span.end();
        }
      });
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
