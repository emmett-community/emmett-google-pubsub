import type { PubSub } from '@google-cloud/pubsub';
import type { Message } from '@event-driven-io/emmett';
import {
  MessageScheduler,
  calculateScheduledTime,
  filterReadyMessages,
} from '../../src/messageBus/scheduler';
import type { ScheduledMessageInfo } from '../../src/messageBus/types';

describe('Scheduler', () => {
  describe('calculateScheduledTime', () => {
    beforeAll(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
    });

    it('should return current time when no options provided', () => {
      const result = calculateScheduledTime();
      expect(result.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    });

    it('should calculate time with afterInMs', () => {
      const result = calculateScheduledTime({ afterInMs: 5000 });
      expect(result.toISOString()).toBe('2024-01-15T10:00:05.000Z');
    });

    it('should return specified date with at option', () => {
      const targetDate = new Date('2024-01-20T15:30:00.000Z');
      const result = calculateScheduledTime({ at: targetDate });
      expect(result.toISOString()).toBe('2024-01-20T15:30:00.000Z');
    });

    it('should handle large afterInMs values', () => {
      const result = calculateScheduledTime({ afterInMs: 86400000 }); // 1 day
      expect(result.toISOString()).toBe('2024-01-16T10:00:00.000Z');
    });

    it('should handle zero afterInMs', () => {
      const result = calculateScheduledTime({ afterInMs: 0 });
      expect(result.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    });
  });

  describe('filterReadyMessages', () => {
    it('should return messages with scheduledAt <= now', () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      const pending: ScheduledMessageInfo[] = [
        {
          message: { type: 'TestMessage1', data: {} },
          scheduledAt: new Date('2024-01-15T09:00:00.000Z'), // past
        },
        {
          message: { type: 'TestMessage2', data: {} },
          scheduledAt: new Date('2024-01-15T10:00:00.000Z'), // exactly now
        },
        {
          message: { type: 'TestMessage3', data: {} },
          scheduledAt: new Date('2024-01-15T11:00:00.000Z'), // future
        },
      ];

      const ready = filterReadyMessages(pending, now);

      expect(ready).toHaveLength(2);
      expect(ready[0].message.type).toBe('TestMessage1');
      expect(ready[1].message.type).toBe('TestMessage2');
    });

    it('should return empty array when no messages are ready', () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      const pending: ScheduledMessageInfo[] = [
        {
          message: { type: 'TestMessage1', data: {} },
          scheduledAt: new Date('2024-01-15T11:00:00.000Z'),
        },
        {
          message: { type: 'TestMessage2', data: {} },
          scheduledAt: new Date('2024-01-15T12:00:00.000Z'),
        },
      ];

      const ready = filterReadyMessages(pending, now);

      expect(ready).toHaveLength(0);
    });

    it('should return all messages when all are ready', () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      const pending: ScheduledMessageInfo[] = [
        {
          message: { type: 'TestMessage1', data: {} },
          scheduledAt: new Date('2024-01-15T09:00:00.000Z'),
        },
        {
          message: { type: 'TestMessage2', data: {} },
          scheduledAt: new Date('2024-01-15T08:00:00.000Z'),
        },
      ];

      const ready = filterReadyMessages(pending, now);

      expect(ready).toHaveLength(2);
    });

    it('should handle empty pending array', () => {
      const now = new Date('2024-01-15T10:00:00.000Z');
      const ready = filterReadyMessages([], now);
      expect(ready).toHaveLength(0);
    });
  });

  describe('MessageScheduler', () => {
    const mockPubSub = {
      topic: jest.fn(),
      close: jest.fn(),
    } as unknown as PubSub;

    beforeEach(() => {
      jest.clearAllMocks();
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T10:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    describe('emulator mode', () => {
      it('should store messages in memory when scheduling', async () => {
        const scheduler = new MessageScheduler({
          useEmulator: true,
          pubsub: mockPubSub,
        });

        const message: Message = { type: 'TestCommand', data: { value: 'test' } };
        await scheduler.schedule(message, { afterInMs: 5000 });

        expect(scheduler.getPendingCount()).toBe(1);
      });

      it('should dequeue ready messages', async () => {
        const scheduler = new MessageScheduler({
          useEmulator: true,
          pubsub: mockPubSub,
        });

        const message1: Message = {
          type: 'TestCommand1',
          data: { value: 'test1' },
        };
        const message2: Message = {
          type: 'TestCommand2',
          data: { value: 'test2' },
        };

        // Schedule for 5 seconds from now
        await scheduler.schedule(message1, { afterInMs: 5000 });
        // Schedule for 10 seconds from now
        await scheduler.schedule(message2, { afterInMs: 10000 });

        expect(scheduler.getPendingCount()).toBe(2);

        // Advance time by 6 seconds
        jest.advanceTimersByTime(6000);

        const ready = scheduler.dequeue();

        expect(ready).toHaveLength(1);
        expect(ready[0].message.type).toBe('TestCommand1');
        expect(scheduler.getPendingCount()).toBe(1);
      });

      it('should remove dequeued messages from pending', async () => {
        const scheduler = new MessageScheduler({
          useEmulator: true,
          pubsub: mockPubSub,
        });

        const message: Message = { type: 'TestCommand', data: { value: 'test' } };
        await scheduler.schedule(message, { afterInMs: 1000 });

        expect(scheduler.getPendingCount()).toBe(1);

        jest.advanceTimersByTime(2000);

        const ready = scheduler.dequeue();
        expect(ready).toHaveLength(1);

        // Dequeue again - should be empty
        const empty = scheduler.dequeue();
        expect(empty).toHaveLength(0);
        expect(scheduler.getPendingCount()).toBe(0);
      });

      it('should schedule with specific date', async () => {
        const scheduler = new MessageScheduler({
          useEmulator: true,
          pubsub: mockPubSub,
        });

        const message: Message = { type: 'TestCommand', data: { value: 'test' } };
        const targetDate = new Date('2024-01-15T10:05:00.000Z');
        await scheduler.schedule(message, { at: targetDate });

        expect(scheduler.getPendingCount()).toBe(1);

        // Not ready yet
        let ready = scheduler.dequeue();
        expect(ready).toHaveLength(0);

        // Advance to target time
        jest.setSystemTime(targetDate);

        // Now ready
        ready = scheduler.dequeue();
        expect(ready).toHaveLength(1);
        expect(ready[0].message.type).toBe('TestCommand');
      });

      it('should clear pending messages', async () => {
        const scheduler = new MessageScheduler({
          useEmulator: true,
          pubsub: mockPubSub,
        });

        const message: Message = { type: 'TestCommand', data: { value: 'test' } };
        await scheduler.schedule(message, { afterInMs: 5000 });

        expect(scheduler.getPendingCount()).toBe(1);

        scheduler.clearPending();

        expect(scheduler.getPendingCount()).toBe(0);
      });

      it('should return empty array from dequeue in production mode', () => {
        const scheduler = new MessageScheduler({
          useEmulator: false,
          pubsub: mockPubSub,
        });

        const ready = scheduler.dequeue();
        expect(ready).toHaveLength(0);
      });
    });

    describe('production mode', () => {
      it('should publish to PubSub topic when scheduling', async () => {
        const mockPublishMessage = jest.fn().mockResolvedValue('message-id');
        const mockExists = jest.fn().mockResolvedValue([false]);
        const mockCreate = jest.fn().mockResolvedValue([]);
        const mockTopic = {
          exists: mockExists,
          create: mockCreate,
          publishMessage: mockPublishMessage,
        };

        (mockPubSub.topic as jest.Mock).mockReturnValue(mockTopic);

        const scheduler = new MessageScheduler({
          useEmulator: false,
          pubsub: mockPubSub,
        });

        const message: Message = { type: 'TestCommand', data: { value: 'test' } };
        await scheduler.schedule(message, { afterInMs: 5000 });

        expect(mockPubSub.topic).toHaveBeenCalledWith(
          'emmett-scheduled-messages',
        );
        expect(mockExists).toHaveBeenCalled();
        expect(mockCreate).toHaveBeenCalled();
        expect(mockPublishMessage).toHaveBeenCalled();

        const publishCall = mockPublishMessage.mock.calls[0][0];
        expect(publishCall.attributes.messageType).toBe('TestCommand');
        expect(publishCall.attributes.publishTime).toBe(
          '2024-01-15T10:00:05.000Z',
        );
      });

      it('should not create topic if it already exists', async () => {
        const mockPublishMessage = jest.fn().mockResolvedValue('message-id');
        const mockExists = jest.fn().mockResolvedValue([true]);
        const mockCreate = jest.fn();
        const mockTopic = {
          exists: mockExists,
          create: mockCreate,
          publishMessage: mockPublishMessage,
        };

        (mockPubSub.topic as jest.Mock).mockReturnValue(mockTopic);

        const scheduler = new MessageScheduler({
          useEmulator: false,
          pubsub: mockPubSub,
        });

        const message: Message = { type: 'TestCommand', data: { value: 'test' } };
        await scheduler.schedule(message, { afterInMs: 5000 });

        expect(mockExists).toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
        expect(mockPublishMessage).toHaveBeenCalled();
      });

      it('should handle publishing errors', async () => {
        const mockPublishMessage = jest
          .fn()
          .mockRejectedValue(new Error('Publish failed'));
        const mockExists = jest.fn().mockResolvedValue([true]);
        const mockTopic = {
          exists: mockExists,
          publishMessage: mockPublishMessage,
        };

        (mockPubSub.topic as jest.Mock).mockReturnValue(mockTopic);

        const scheduler = new MessageScheduler({
          useEmulator: false,
          pubsub: mockPubSub,
        });

        const message: Message = { type: 'TestCommand', data: { value: 'test' } };

        await expect(
          scheduler.schedule(message, { afterInMs: 5000 }),
        ).rejects.toThrow('Failed to publish scheduled message TestCommand');
      });

      it('should return 0 pending count in production mode', () => {
        const scheduler = new MessageScheduler({
          useEmulator: false,
          pubsub: mockPubSub,
        });

        expect(scheduler.getPendingCount()).toBe(0);
      });

      it('should not clear anything in production mode', () => {
        const scheduler = new MessageScheduler({
          useEmulator: false,
          pubsub: mockPubSub,
        });

        // Should not throw
        scheduler.clearPending();

        expect(scheduler.getPendingCount()).toBe(0);
      });
    });

    describe('custom topic prefix', () => {
      it('should use custom topic prefix', async () => {
        const mockPublishMessage = jest.fn().mockResolvedValue('message-id');
        const mockExists = jest.fn().mockResolvedValue([false]);
        const mockCreate = jest.fn().mockResolvedValue([]);
        const mockTopic = {
          exists: mockExists,
          create: mockCreate,
          publishMessage: mockPublishMessage,
        };

        (mockPubSub.topic as jest.Mock).mockReturnValue(mockTopic);

        const scheduler = new MessageScheduler({
          useEmulator: false,
          pubsub: mockPubSub,
          topicPrefix: 'custom',
        });

        const message: Message = { type: 'TestCommand', data: { value: 'test' } };
        await scheduler.schedule(message, { afterInMs: 5000 });

        expect(mockPubSub.topic).toHaveBeenCalledWith('custom-scheduled-messages');
      });
    });
  });
});
