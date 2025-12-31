import type { Message as PubSubMessage, Subscription } from '@google-cloud/pubsub';
import type {
  AnyMessage,
  Command,
  Event,
  SingleRawMessageHandlerWithoutContext,
} from '@event-driven-io/emmett';
import { EmmettError } from '@event-driven-io/emmett';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { deserialize } from './serialization';
import { safeLog } from './observability';
import type { Logger } from './types';

const tracer = trace.getTracer('@emmett-community/emmett-google-pubsub');

/**
 * Determine if an error should trigger a retry (nack) or be considered permanent (ack)
 *
 * @param error - The error to classify
 * @returns true if the error is retriable (should nack), false if permanent (should ack)
 */
export function shouldRetry(error: unknown): boolean {
  if (!(error instanceof Error)) {
    // Unknown error types - retry to be safe
    return true;
  }

  const errorMessage = error.message.toLowerCase();

  // Network/timeout errors - retry
  if (
    errorMessage.includes('network') ||
    errorMessage.includes('timeout') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('enotfound') ||
    errorMessage.includes('unavailable')
  ) {
    return true;
  }

  // EmmettError and validation errors - don't retry (business logic errors)
  if (error instanceof EmmettError) {
    return false;
  }

  if (
    errorMessage.includes('validation') ||
    errorMessage.includes('invalid') ||
    errorMessage.includes('not found') ||
    errorMessage.includes('already exists')
  ) {
    return false;
  }

  // Default to retry for unknown errors
  return true;
}

/**
 * Process an incoming command message from PubSub
 *
 * @param message - The PubSub message
 * @param handlers - Map of message type to handlers
 * @param commandType - The command type being processed
 * @param logger - Optional logger for observability
 * @returns 'ack' if successful or permanent failure, 'nack' if retriable failure
 */
export async function handleCommandMessage(
  message: PubSubMessage,
  handlers: Map<string, SingleRawMessageHandlerWithoutContext<AnyMessage>[]>,
  commandType: string,
  logger?: Logger,
): Promise<'ack' | 'nack'> {
  const span = tracer.startSpan('emmett.pubsub.handle_command', {
    attributes: { 'emmett.message.kind': 'command' },
  });

  try {
    // Get handlers for this command type
    const commandHandlers = handlers.get(commandType);

    if (!commandHandlers || commandHandlers.length === 0) {
      throw new EmmettError(
        `No handler registered for command ${commandType}!`,
      );
    }

    // Commands must have exactly one handler
    if (commandHandlers.length > 1) {
      throw new EmmettError(
        `Multiple handlers registered for command ${commandType}. ` +
          `Commands must have exactly one handler.`,
      );
    }

    // Deserialize the command
    const command = deserialize<Command>(message.data);

    // Execute the handler
    const handler = commandHandlers[0];
    await handler(command);

    span.setStatus({ code: SpanStatusCode.OK });
    return 'ack';
  } catch (error) {
    safeLog.error(logger, 'Command handler failed', error);

    // Determine if we should retry
    if (shouldRetry(error)) {
      safeLog.info(logger, 'Nacking command for retry');
      span.setStatus({ code: SpanStatusCode.OK });
      return 'nack';
    } else {
      safeLog.warn(logger, 'Acking command despite error');
      span.setStatus({ code: SpanStatusCode.OK });
      return 'ack';
    }
  } finally {
    span.end();
  }
}

/**
 * Process an incoming event message from PubSub
 *
 * @param message - The PubSub message
 * @param handlers - Map of message type to handlers
 * @param eventType - The event type being processed
 * @param logger - Optional logger for observability
 * @returns 'ack' if all handlers successful or permanent failure, 'nack' if retriable failure
 */
export async function handleEventMessage(
  message: PubSubMessage,
  handlers: Map<string, SingleRawMessageHandlerWithoutContext<AnyMessage>[]>,
  eventType: string,
  logger?: Logger,
): Promise<'ack' | 'nack'> {
  const span = tracer.startSpan('emmett.pubsub.handle_event', {
    attributes: { 'emmett.message.kind': 'event' },
  });

  try {
    // Get handlers for this event type
    const eventHandlers = handlers.get(eventType);

    if (!eventHandlers || eventHandlers.length === 0) {
      // Events without handlers are silently ignored (valid scenario)
      safeLog.debug(logger, 'No handlers registered for event');
      span.setStatus({ code: SpanStatusCode.OK });
      return 'ack';
    }

    // Deserialize the event
    const event = deserialize<Event>(message.data);

    // Execute all handlers sequentially
    for (const handler of eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        safeLog.error(logger, 'Event handler failed', error);

        // If any handler fails with a retriable error, nack the whole message
        if (shouldRetry(error)) {
          safeLog.info(logger, 'Nacking event for retry');
          span.setStatus({ code: SpanStatusCode.OK });
          return 'nack';
        }
        // Otherwise continue to next handler
        safeLog.warn(logger, 'Continuing event processing despite error');
      }
    }

    span.setStatus({ code: SpanStatusCode.OK });
    return 'ack';
  } catch (error) {
    // Error deserializing or other unexpected error
    safeLog.error(logger, 'Event handling failed', error);

    if (shouldRetry(error)) {
      span.setStatus({ code: SpanStatusCode.OK });
      return 'nack';
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
      return 'ack';
    }
  } finally {
    span.end();
  }
}

/**
 * Create a message listener for a PubSub subscription
 *
 * @param subscription - The PubSub subscription to listen on
 * @param messageType - The message type (command or event type)
 * @param kind - Whether this is a command or event
 * @param handlers - Map of message type to handlers
 * @param logger - Optional logger for observability
 */
export function createMessageListener(
  subscription: Subscription,
  messageType: string,
  kind: 'command' | 'event',
  handlers: Map<string, SingleRawMessageHandlerWithoutContext<AnyMessage>[]>,
  logger?: Logger,
): void {
  subscription.on('message', async (message: PubSubMessage) => {
    try {
      // Route to appropriate handler based on kind
      const result =
        kind === 'command'
          ? await handleCommandMessage(message, handlers, messageType, logger)
          : await handleEventMessage(message, handlers, messageType, logger);

      // Acknowledge or nack based on result
      if (result === 'ack') {
        message.ack();
      } else {
        message.nack();
      }
    } catch (error) {
      // Unexpected error in listener itself - log and nack
      safeLog.error(logger, 'Unexpected error in message listener', error);
      message.nack();
    }
  });

  subscription.on('error', (error) => {
    safeLog.error(logger, 'Subscription error', error);
  });
}
