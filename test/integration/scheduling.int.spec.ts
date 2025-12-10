import type { Message } from '@event-driven-io/emmett';
import { getTestMessageBus, createTestCommand, waitFor } from './helpers';

describe('Scheduling Integration Tests', () => {
  describe('message scheduling in emulator mode', () => {
    it('should schedule message with afterInMs', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        const message = createTestCommand('cmd-1', 'test');
        messageBus.schedule(message, { afterInMs: 1000 });

        // Message should not be ready immediately
        let scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(0);

        // Wait for message to be ready
        await new Promise((resolve) => setTimeout(resolve, 1100));

        // Now message should be ready
        scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].message.type).toBe('TestCommand');
        expect(scheduled[0].message.data).toEqual({
          id: 'cmd-1',
          value: 'test',
        });
      } finally {
        await messageBus.close();
      }
    });

    it('should schedule message with specific date', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        const scheduledDate = new Date(Date.now() + 1000);
        const message = createTestCommand('cmd-1', 'test');
        messageBus.schedule(message, { at: scheduledDate });

        // Message should not be ready immediately
        let scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(0);

        // Wait until scheduled time
        await new Promise((resolve) => setTimeout(resolve, 1100));

        // Now message should be ready
        scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].message.type).toBe('TestCommand');
      } finally {
        await messageBus.close();
      }
    });

    it('should schedule multiple messages', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        messageBus.schedule(createTestCommand('cmd-1', 'first'), {
          afterInMs: 500,
        });
        messageBus.schedule(createTestCommand('cmd-2', 'second'), {
          afterInMs: 1000,
        });
        messageBus.schedule(createTestCommand('cmd-3', 'third'), {
          afterInMs: 1500,
        });

        // Wait for first message
        await new Promise((resolve) => setTimeout(resolve, 600));
        let scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].message.data.id).toBe('cmd-1');

        // Wait for second message
        await new Promise((resolve) => setTimeout(resolve, 500));
        scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].message.data.id).toBe('cmd-2');

        // Wait for third message
        await new Promise((resolve) => setTimeout(resolve, 600));
        scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].message.data.id).toBe('cmd-3');
      } finally {
        await messageBus.close();
      }
    });

    it('should return multiple ready messages in single dequeue', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        // Schedule multiple messages with same delay
        messageBus.schedule(createTestCommand('cmd-1', 'first'), {
          afterInMs: 500,
        });
        messageBus.schedule(createTestCommand('cmd-2', 'second'), {
          afterInMs: 500,
        });
        messageBus.schedule(createTestCommand('cmd-3', 'third'), {
          afterInMs: 500,
        });

        // Wait for all to be ready
        await new Promise((resolve) => setTimeout(resolve, 600));

        const scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(3);

        const ids = scheduled.map((s) => s.message.data.id).sort();
        expect(ids).toEqual(['cmd-1', 'cmd-2', 'cmd-3']);
      } finally {
        await messageBus.close();
      }
    });

    it('should remove dequeued messages from pending', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        messageBus.schedule(createTestCommand('cmd-1', 'test'), {
          afterInMs: 500,
        });

        await new Promise((resolve) => setTimeout(resolve, 600));

        const first = messageBus.dequeue();
        expect(first).toHaveLength(1);

        // Dequeue again - should be empty
        const second = messageBus.dequeue();
        expect(second).toHaveLength(0);
      } finally {
        await messageBus.close();
      }
    });

    it('should preserve scheduled options', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        const message = createTestCommand('cmd-1', 'test');
        messageBus.schedule(message, { afterInMs: 500 });

        await new Promise((resolve) => setTimeout(resolve, 600));

        const scheduled = messageBus.dequeue();
        expect(scheduled[0].options).toEqual({ afterInMs: 500 });
      } finally {
        await messageBus.close();
      }
    });

    it('should schedule message without options (immediate)', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        const message = createTestCommand('cmd-1', 'test');
        messageBus.schedule(message);

        // Should be ready immediately
        const scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(1);
        expect(scheduled[0].message.type).toBe('TestCommand');
      } finally {
        await messageBus.close();
      }
    });

    it('should schedule commands and events', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        const command: Message = {
          type: 'TestCommand',
          data: { id: 'cmd-1' },
        };
        const event: Message = {
          type: 'TestEvent',
          data: { id: 'evt-1' },
        };

        messageBus.schedule(command, { afterInMs: 500 });
        messageBus.schedule(event, { afterInMs: 500 });

        await new Promise((resolve) => setTimeout(resolve, 600));

        const scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(2);

        const types = scheduled.map((s) => s.message.type).sort();
        expect(types).toEqual(['TestCommand', 'TestEvent']);
      } finally {
        await messageBus.close();
      }
    });

    it('should handle past scheduled dates', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        const pastDate = new Date(Date.now() - 1000);
        const message = createTestCommand('cmd-1', 'test');
        messageBus.schedule(message, { at: pastDate });

        // Should be ready immediately
        const scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(1);
      } finally {
        await messageBus.close();
      }
    });
  });

  describe('scheduling with message handling', () => {
    it('should integrate scheduled messages with command handling', async () => {
      const messageBus = getTestMessageBus();
      const receivedCommands: Message[] = [];

      messageBus.handle(
        async (command: Message) => {
          receivedCommands.push(command);
        },
        'TestCommand',
      );

      await messageBus.start();

      try {
        // Schedule a command
        messageBus.schedule(createTestCommand('cmd-1', 'scheduled'), {
          afterInMs: 500,
        });

        await new Promise((resolve) => setTimeout(resolve, 600));

        // Dequeue and manually process (in emulator mode)
        const scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(1);

        // In a real application, you would send the dequeued message
        await messageBus.send(scheduled[0].message as any);

        await waitFor(() => receivedCommands.length > 0);

        expect(receivedCommands).toHaveLength(1);
        expect(receivedCommands[0].data.id).toBe('cmd-1');
      } finally {
        await messageBus.close();
      }
    });
  });

  describe('scheduling edge cases', () => {
    it('should handle zero delay', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        messageBus.schedule(createTestCommand('cmd-1', 'test'), {
          afterInMs: 0,
        });

        const scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(1);
      } finally {
        await messageBus.close();
      }
    });

    it('should handle very long delays', async () => {
      const messageBus = getTestMessageBus();

      await messageBus.start();

      try {
        messageBus.schedule(createTestCommand('cmd-1', 'test'), {
          afterInMs: 86400000, // 1 day
        });

        // Should not be ready yet
        const scheduled = messageBus.dequeue();
        expect(scheduled).toHaveLength(0);
      } finally {
        await messageBus.close();
      }
    });

    it('should handle scheduling before start', () => {
      const messageBus = getTestMessageBus();

      // Should not throw when scheduling before start (stored in memory)
      expect(() => {
        messageBus.schedule(createTestCommand('cmd-1', 'test'), {
          afterInMs: 1000,
        });
      }).not.toThrow();
    });
  });
});
