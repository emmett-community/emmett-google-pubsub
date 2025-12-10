import { randomUUID } from 'crypto';
import type { Command, Event, Message } from '@event-driven-io/emmett';
import type { PubSubMessageEnvelope } from './types';

/**
 * Date marker for JSON serialization
 */
interface DateMarker {
  __type: 'Date';
  value: string;
}

/**
 * Recursively transform Dates to DateMarkers in an object
 */
function transformDatesToMarkers(obj: unknown): unknown {
  if (obj instanceof Date) {
    return {
      __type: 'Date',
      value: obj.toISOString(),
    } satisfies DateMarker;
  }

  if (Array.isArray(obj)) {
    return obj.map(transformDatesToMarkers);
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = transformDatesToMarkers(value);
    }
    return result;
  }

  return obj;
}

/**
 * Check if a value is a Date marker
 */
function isDateMarker(value: unknown): value is DateMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__type' in value &&
    (value as DateMarker).__type === 'Date' &&
    'value' in value &&
    typeof (value as DateMarker).value === 'string'
  );
}

/**
 * JSON reviver that converts Date markers back to Dates
 */
function dateReviver(_key: string, value: unknown): unknown {
  if (isDateMarker(value)) {
    return new Date(value.value);
  }
  return value;
}

/**
 * Determine if a message is a command or event based on its type
 */
function getMessageKind(message: Message): 'command' | 'event' {
  // Simple heuristic: if the message type contains "Command", it's a command
  // Otherwise, it's an event
  // This can be customized based on your naming conventions
  const typeStr = message.type.toLowerCase();
  return typeStr.includes('command') ? 'command' : 'event';
}

/**
 * Serialize a Command or Event to a Buffer for PubSub transport
 *
 * @param message - The message to serialize
 * @returns Buffer containing the serialized message envelope
 */
export function serialize(message: Command | Event): Buffer {
  const envelope = {
    type: message.type,
    kind: getMessageKind(message),
    data: transformDatesToMarkers(message.data),
    metadata: 'metadata' in message ? transformDatesToMarkers(message.metadata) : undefined,
    timestamp: new Date().toISOString(),
    messageId: randomUUID(),
  };

  const json = JSON.stringify(envelope);
  return Buffer.from(json);
}

/**
 * Deserialize a Buffer from PubSub into a Command or Event
 *
 * @param buffer - The buffer containing the serialized message
 * @returns The deserialized message
 * @throws Error if the buffer cannot be deserialized
 */
export function deserialize<T extends Command | Event>(buffer: Buffer): T {
  try {
    const json = buffer.toString('utf-8');
    const envelope = JSON.parse(json, dateReviver) as PubSubMessageEnvelope;

    const message = {
      type: envelope.type,
      data: envelope.data,
      ...(envelope.metadata ? { metadata: envelope.metadata } : {}),
    } as Message;

    return message as T;
  } catch (error) {
    throw new Error(
      `Failed to deserialize message: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Attach a message ID to a message for idempotency tracking
 *
 * @param message - The message to attach ID to
 * @param messageId - The message ID
 * @returns The message with the ID attached
 */
export function attachMessageId<T extends Message>(
  message: T,
  messageId: string,
): T & { __messageId: string } {
  return {
    ...message,
    __messageId: messageId,
  };
}

/**
 * Extract message ID from a message
 *
 * @param message - The message to extract ID from
 * @returns The message ID if present, undefined otherwise
 */
export function extractMessageId(message: Message): string | undefined {
  return '__messageId' in message
    ? (message as { __messageId: string }).__messageId
    : undefined;
}
