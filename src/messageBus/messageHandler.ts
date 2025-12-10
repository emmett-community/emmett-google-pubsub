import type { Message as PubSubMessage, Subscription } from '@google-cloud/pubsub';
import type {
  AnyMessage,
  Command,
  Event,
  SingleRawMessageHandlerWithoutContext,
} from '@event-driven-io/emmett';
import { EmmettError } from '@event-driven-io/emmett';
import { deserialize } from './serialization';

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
 * @returns 'ack' if successful or permanent failure, 'nack' if retriable failure
 */
export async function handleCommandMessage(
  message: PubSubMessage,
  handlers: Map<string, SingleRawMessageHandlerWithoutContext<AnyMessage>[]>,
  commandType: string,
): Promise<'ack' | 'nack'> {
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

    return 'ack';
  } catch (error) {
    console.error(
      `Error handling command ${commandType}:`,
      error instanceof Error ? error.message : String(error),
    );

    // Determine if we should retry
    if (shouldRetry(error)) {
      console.info(
        `Nacking command ${commandType} for retry (delivery attempt: ${message.deliveryAttempt})`,
      );
      return 'nack';
    } else {
      console.warn(
        `Acking command ${commandType} despite error (permanent failure)`,
      );
      return 'ack';
    }
  }
}

/**
 * Process an incoming event message from PubSub
 *
 * @param message - The PubSub message
 * @param handlers - Map of message type to handlers
 * @param eventType - The event type being processed
 * @returns 'ack' if all handlers successful or permanent failure, 'nack' if retriable failure
 */
export async function handleEventMessage(
  message: PubSubMessage,
  handlers: Map<string, SingleRawMessageHandlerWithoutContext<AnyMessage>[]>,
  eventType: string,
): Promise<'ack' | 'nack'> {
  try {
    // Get handlers for this event type
    const eventHandlers = handlers.get(eventType);

    if (!eventHandlers || eventHandlers.length === 0) {
      // Events without handlers are silently ignored (valid scenario)
      console.debug(`No handlers registered for event ${eventType}, skipping`);
      return 'ack';
    }

    // Deserialize the event
    const event = deserialize<Event>(message.data);

    // Execute all handlers sequentially
    for (const handler of eventHandlers) {
      try {
        await handler(event);
      } catch (error) {
        console.error(
          `Error in event handler for ${eventType}:`,
          error instanceof Error ? error.message : String(error),
        );

        // If any handler fails with a retriable error, nack the whole message
        if (shouldRetry(error)) {
          console.info(
            `Nacking event ${eventType} for retry due to handler failure (delivery attempt: ${message.deliveryAttempt})`,
          );
          return 'nack';
        }
        // Otherwise continue to next handler
        console.warn(
          `Continuing event ${eventType} processing despite handler error (permanent failure)`,
        );
      }
    }

    return 'ack';
  } catch (error) {
    // Error deserializing or other unexpected error
    console.error(
      `Error handling event ${eventType}:`,
      error instanceof Error ? error.message : String(error),
    );

    if (shouldRetry(error)) {
      return 'nack';
    } else {
      return 'ack';
    }
  }
}

/**
 * Create a message listener for a PubSub subscription
 *
 * @param subscription - The PubSub subscription to listen on
 * @param messageType - The message type (command or event type)
 * @param kind - Whether this is a command or event
 * @param handlers - Map of message type to handlers
 */
export function createMessageListener(
  subscription: Subscription,
  messageType: string,
  kind: 'command' | 'event',
  handlers: Map<string, SingleRawMessageHandlerWithoutContext<AnyMessage>[]>,
): void {
  subscription.on('message', async (message: PubSubMessage) => {
    try {
      // Route to appropriate handler based on kind
      const result =
        kind === 'command'
          ? await handleCommandMessage(message, handlers, messageType)
          : await handleEventMessage(message, handlers, messageType);

      // Acknowledge or nack based on result
      if (result === 'ack') {
        message.ack();
      } else {
        message.nack();
      }
    } catch (error) {
      // Unexpected error in listener itself - log and nack
      console.error(
        `Unexpected error in message listener for ${messageType}:`,
        error instanceof Error ? error.message : String(error),
      );
      message.nack();
    }
  });

  subscription.on('error', (error) => {
    console.error(
      `Subscription error for ${messageType}:`,
      error instanceof Error ? error.message : String(error),
    );
  });
}
