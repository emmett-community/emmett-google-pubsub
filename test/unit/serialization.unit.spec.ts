import type { Command, Event } from '@event-driven-io/emmett';
import {
  serialize,
  deserialize,
  attachMessageId,
  extractMessageId,
} from '../../src/messageBus/serialization';

describe('Serialization', () => {
  describe('serialize and deserialize', () => {
    it('should serialize and deserialize a simple command', () => {
      type TestCommand = Command<
        'TestCommand',
        { value: string; count: number }
      >;

      const command: TestCommand = {
        type: 'TestCommand',
        data: {
          value: 'test',
          count: 42,
        },
      };

      const buffer = serialize(command);
      const deserialized = deserialize<TestCommand>(buffer);

      expect(deserialized.type).toBe(command.type);
      expect(deserialized.data).toEqual(command.data);
    });

    it('should serialize and deserialize an event', () => {
      type TestEvent = Event<'TestEvent', { id: string; amount: number }>;

      const event: TestEvent = {
        type: 'TestEvent',
        data: {
          id: '123',
          amount: 100.5,
        },
      };

      const buffer = serialize(event);
      const deserialized = deserialize<TestEvent>(buffer);

      expect(deserialized.type).toBe(event.type);
      expect(deserialized.data).toEqual(event.data);
    });

    it('should preserve Date objects in data', () => {
      type TestCommand = Command<'TestCommand', { createdAt: Date }>;

      const now = new Date('2024-01-15T10:30:00.000Z');
      const command: TestCommand = {
        type: 'TestCommand',
        data: {
          createdAt: now,
        },
      };

      const buffer = serialize(command);
      const deserialized = deserialize<TestCommand>(buffer);

      expect(deserialized.data.createdAt).toBeInstanceOf(Date);
      expect(deserialized.data.createdAt.toISOString()).toBe(now.toISOString());
    });

    it('should preserve nested Date objects', () => {
      type TestCommand = Command<
        'TestCommand',
        {
          user: {
            name: string;
            registeredAt: Date;
          };
          events: Array<{ name: string; occurredAt: Date }>;
        }
      >;

      const date1 = new Date('2024-01-15T10:30:00.000Z');
      const date2 = new Date('2024-01-16T14:45:00.000Z');

      const command: TestCommand = {
        type: 'TestCommand',
        data: {
          user: {
            name: 'Alice',
            registeredAt: date1,
          },
          events: [
            {
              name: 'LoginEvent',
              occurredAt: date2,
            },
          ],
        },
      };

      const buffer = serialize(command);
      const deserialized = deserialize<TestCommand>(buffer);

      expect(deserialized.data.user.registeredAt).toBeInstanceOf(Date);
      expect(deserialized.data.user.registeredAt.toISOString()).toBe(
        date1.toISOString(),
      );
      expect(deserialized.data.events[0].occurredAt).toBeInstanceOf(Date);
      expect(deserialized.data.events[0].occurredAt.toISOString()).toBe(
        date2.toISOString(),
      );
    });

    it('should preserve metadata', () => {
      type TestEvent = Event<
        'TestEvent',
        { value: string },
        { userId: string; correlationId: string }
      >;

      const event: TestEvent = {
        type: 'TestEvent',
        data: {
          value: 'test',
        },
        metadata: {
          userId: 'user-123',
          correlationId: 'corr-456',
        },
      };

      const buffer = serialize(event);
      const deserialized = deserialize<TestEvent>(buffer);

      expect(deserialized.metadata).toEqual(event.metadata);
    });

    it('should preserve Date in metadata', () => {
      type TestEvent = Event<
        'TestEvent',
        { id: string },
        { timestamp: Date; userId: string }
      >;

      const timestamp = new Date('2024-01-15T10:30:00.000Z');
      const event: TestEvent = {
        type: 'TestEvent',
        data: {
          id: '123',
        },
        metadata: {
          timestamp,
          userId: 'user-123',
        },
      };

      const buffer = serialize(event);
      const deserialized = deserialize<TestEvent>(buffer);

      expect(deserialized.metadata?.timestamp).toBeInstanceOf(Date);
      expect(deserialized.metadata?.timestamp.toISOString()).toBe(
        timestamp.toISOString(),
      );
      expect(deserialized.metadata?.userId).toBe('user-123');
    });

    it('should handle messages without metadata', () => {
      type TestCommand = Command<'TestCommand', { value: string }>;

      const command: TestCommand = {
        type: 'TestCommand',
        data: {
          value: 'test',
        },
      };

      const buffer = serialize(command);
      const deserialized = deserialize<TestCommand>(buffer);

      expect(deserialized.metadata).toBeUndefined();
    });

    it('should handle complex nested structures', () => {
      type TestCommand = Command<
        'TestCommand',
        {
          items: Array<{
            id: string;
            quantity: number;
            addedAt: Date;
            metadata: {
              source: string;
              modifiedAt: Date;
            };
          }>;
        }
      >;

      const date1 = new Date('2024-01-15T10:30:00.000Z');
      const date2 = new Date('2024-01-15T11:00:00.000Z');

      const command: TestCommand = {
        type: 'TestCommand',
        data: {
          items: [
            {
              id: 'item-1',
              quantity: 5,
              addedAt: date1,
              metadata: {
                source: 'web',
                modifiedAt: date2,
              },
            },
          ],
        },
      };

      const buffer = serialize(command);
      const deserialized = deserialize<TestCommand>(buffer);

      expect(deserialized.data.items[0].addedAt).toBeInstanceOf(Date);
      expect(deserialized.data.items[0].addedAt.toISOString()).toBe(
        date1.toISOString(),
      );
      expect(
        deserialized.data.items[0].metadata.modifiedAt,
      ).toBeInstanceOf(Date);
      expect(
        deserialized.data.items[0].metadata.modifiedAt.toISOString(),
      ).toBe(date2.toISOString());
    });

    it('should throw error on invalid buffer', () => {
      const invalidBuffer = Buffer.from('invalid json');

      expect(() => deserialize(invalidBuffer)).toThrow(
        'Failed to deserialize message',
      );
    });

    it('should handle empty objects', () => {
      type TestCommand = Command<'TestCommand', Record<string, never>>;

      const command: TestCommand = {
        type: 'TestCommand',
        data: {},
      };

      const buffer = serialize(command);
      const deserialized = deserialize<TestCommand>(buffer);

      expect(deserialized.type).toBe(command.type);
      expect(deserialized.data).toEqual({});
    });

    it('should handle null and undefined values', () => {
      type TestCommand = Command<
        'TestCommand',
        { nullValue: null; undefinedValue?: undefined; value: string }
      >;

      const command: TestCommand = {
        type: 'TestCommand',
        data: {
          nullValue: null,
          undefinedValue: undefined,
          value: 'test',
        },
      };

      const buffer = serialize(command);
      const deserialized = deserialize<TestCommand>(buffer);

      expect(deserialized.data.nullValue).toBeNull();
      // undefined values are not preserved in JSON
      expect(deserialized.data.undefinedValue).toBeUndefined();
      expect(deserialized.data.value).toBe('test');
    });
  });

  describe('attachMessageId and extractMessageId', () => {
    it('should attach and extract message ID', () => {
      type TestCommand = Command<'TestCommand', { value: string }>;

      const command: TestCommand = {
        type: 'TestCommand',
        data: {
          value: 'test',
        },
      };

      const messageId = '123e4567-e89b-12d3-a456-426614174000';
      const withId = attachMessageId(command, messageId);

      expect(extractMessageId(withId)).toBe(messageId);
    });

    it('should return undefined for message without ID', () => {
      type TestCommand = Command<'TestCommand', { value: string }>;

      const command: TestCommand = {
        type: 'TestCommand',
        data: {
          value: 'test',
        },
      };

      expect(extractMessageId(command)).toBeUndefined();
    });

    it('should preserve original message properties', () => {
      type TestEvent = Event<
        'TestEvent',
        { value: string },
        { userId: string }
      >;

      const event: TestEvent = {
        type: 'TestEvent',
        data: {
          value: 'test',
        },
        metadata: {
          userId: 'user-123',
        },
      };

      const messageId = '123e4567-e89b-12d3-a456-426614174000';
      const withId = attachMessageId(event, messageId);

      expect(withId.type).toBe(event.type);
      expect(withId.data).toEqual(event.data);
      expect(withId.metadata).toEqual(event.metadata);
    });
  });
});
