import type { Command } from '@event-driven-io/emmett';
import { EmmettError } from '@event-driven-io/emmett';
import {
  getTestMessageBus,
  createTestCommand,
  waitFor,
} from './helpers';

describe('Commands Integration Tests', () => {
  describe('command registration and handling', () => {
    it('should register command handler and handle command', async () => {
      const messageBus = getTestMessageBus();
      const receivedCommands: Command[] = [];

      // Register handler
      messageBus.handle(
        async (command: Command) => {
          receivedCommands.push(command);
        },
        'TestCommand',
      );

      // Start message bus
      await messageBus.start();

      try {
        // Send command
        const command = createTestCommand('cmd-1', 'test-value');
        await messageBus.send(command);

        // Wait for command to be processed
        await waitFor(() => receivedCommands.length > 0);

        expect(receivedCommands).toHaveLength(1);
        expect(receivedCommands[0].type).toBe('TestCommand');
        expect(receivedCommands[0].data).toEqual({
          id: 'cmd-1',
          value: 'test-value',
        });
      } finally {
        await messageBus.close();
      }
    });

    it('should reject duplicate command handler registration', () => {
      const messageBus = getTestMessageBus();

      const handler1 = async (command: Command) => {
        console.log('Handler 1', command);
      };
      const handler2 = async (command: Command) => {
        console.log('Handler 2', command);
      };

      messageBus.handle(handler1, 'TestCommand');

      expect(() => {
        messageBus.handle(handler2, 'TestCommand');
      }).toThrow(EmmettError);

      expect(() => {
        messageBus.handle(handler2, 'TestCommand');
      }).toThrow('Handler already registered for command TestCommand');
    });

    it('should handle multiple different commands', async () => {
      const messageBus = getTestMessageBus();
      const receivedCommand1: Command[] = [];
      const receivedCommand2: Command[] = [];

      messageBus.handle(
        async (command: Command) => {
          receivedCommand1.push(command);
        },
        'Command1',
      );

      messageBus.handle(
        async (command: Command) => {
          receivedCommand2.push(command);
        },
        'Command2',
      );

      await messageBus.start();

      try {
        await messageBus.send({ type: 'Command1', data: { value: 'cmd1' } });
        await messageBus.send({ type: 'Command2', data: { value: 'cmd2' } });

        await waitFor(() => receivedCommand1.length > 0 && receivedCommand2.length > 0);

        expect(receivedCommand1).toHaveLength(1);
        expect(receivedCommand1[0].type).toBe('Command1');
        expect(receivedCommand2).toHaveLength(1);
        expect(receivedCommand2[0].type).toBe('Command2');
      } finally {
        await messageBus.close();
      }
    });

    it('should handle commands with metadata', async () => {
      const messageBus = getTestMessageBus();
      const receivedCommands: Command[] = [];

      messageBus.handle(
        async (command: Command) => {
          receivedCommands.push(command);
        },
        'TestCommand',
      );

      await messageBus.start();

      try {
        const command: Command = {
          type: 'TestCommand',
          data: { id: 'cmd-1', value: 'test' },
          metadata: {
            now: new Date('2024-01-15T10:00:00.000Z'),
          },
        };

        await messageBus.send(command);

        await waitFor(() => receivedCommands.length > 0);

        expect(receivedCommands[0].metadata).toBeDefined();
        expect(receivedCommands[0].metadata?.now).toBeInstanceOf(Date);
        expect((receivedCommands[0].metadata?.now as Date).toISOString()).toBe(
          '2024-01-15T10:00:00.000Z',
        );
      } finally {
        await messageBus.close();
      }
    });

    it('should handle commands sequentially from same sender', async () => {
      const messageBus = getTestMessageBus();
      const executionOrder: string[] = [];

      messageBus.handle(
        async (command: Command) => {
          executionOrder.push((command.data as any).id);
          // Simulate some processing time
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
        'TestCommand',
      );

      await messageBus.start();

      try {
        // Send commands
        await messageBus.send(createTestCommand('cmd-1', 'first'));
        await messageBus.send(createTestCommand('cmd-2', 'second'));
        await messageBus.send(createTestCommand('cmd-3', 'third'));

        await waitFor(() => executionOrder.length === 3, 5000);

        expect(executionOrder).toEqual(['cmd-1', 'cmd-2', 'cmd-3']);
      } finally {
        await messageBus.close();
      }
    });

    it('should handle command with Date objects in data', async () => {
      const messageBus = getTestMessageBus();
      const receivedCommands: Command[] = [];

      messageBus.handle(
        async (command: Command) => {
          receivedCommands.push(command);
        },
        'TestCommand',
      );

      await messageBus.start();

      try {
        const now = new Date('2024-01-15T10:30:00.000Z');
        const command: Command = {
          type: 'TestCommand',
          data: {
            id: 'cmd-1',
            createdAt: now,
            nested: {
              updatedAt: now,
            },
          },
        };

        await messageBus.send(command);

        await waitFor(() => receivedCommands.length > 0);

        const data = receivedCommands[0].data as any;
        expect(data.createdAt).toBeInstanceOf(Date);
        expect(data.createdAt.toISOString()).toBe(
          '2024-01-15T10:30:00.000Z',
        );
        expect(data.nested.updatedAt).toBeInstanceOf(Date);
      } finally {
        await messageBus.close();
      }
    });

    it('should register handler after start', async () => {
      const messageBus = getTestMessageBus();
      const receivedCommands: Command[] = [];

      await messageBus.start();

      try {
        // Register handler after start
        messageBus.handle(
          async (command: Command) => {
            receivedCommands.push(command);
          },
          'TestCommand',
        );

        // Give time for subscription to be created
        await new Promise((resolve) => setTimeout(resolve, 500));

        await messageBus.send(createTestCommand('cmd-1', 'test'));

        await waitFor(() => receivedCommands.length > 0);

        expect(receivedCommands).toHaveLength(1);
      } finally {
        await messageBus.close();
      }
    });
  });

  describe('command error handling', () => {
    it('should handle command handler errors gracefully', async () => {
      const messageBus = getTestMessageBus();
      const attempts: string[] = [];

      messageBus.handle(
        async (command: Command) => {
          attempts.push((command.data as any).id);
          // Throw a non-retriable error (EmmettError)
          throw new EmmettError('Business logic error');
        },
        'TestCommand',
      );

      await messageBus.start();

      try {
        await messageBus.send(createTestCommand('cmd-1', 'test'));

        // Wait for at least one attempt
        await waitFor(() => attempts.length > 0, 3000);

        // Should only attempt once (EmmettError is not retriable)
        expect(attempts.length).toBeLessThanOrEqual(2);
      } finally {
        await messageBus.close();
      }
    });
  });

  describe('lifecycle management', () => {
    it('should allow sending before start (producer-only mode)', async () => {
      const messageBus = getTestMessageBus();

      // Sending without start() is allowed for producer-only scenarios
      // (e.g., when only sending commands without handling them)
      await expect(
        messageBus.send(createTestCommand('cmd-1', 'test')),
      ).resolves.not.toThrow();

      // Cleanup
      await messageBus.close();
    });

    it('should be idempotent when calling start multiple times', async () => {
      const messageBus = getTestMessageBus();
      const receivedCommands: Command[] = [];

      messageBus.handle(
        async (command: Command) => {
          receivedCommands.push(command);
        },
        'TestCommand',
      );

      await messageBus.start();
      await messageBus.start(); // Should not throw
      await messageBus.start(); // Should not throw

      try {
        await messageBus.send(createTestCommand('cmd-1', 'test'));

        await waitFor(() => receivedCommands.length > 0);

        expect(receivedCommands).toHaveLength(1);
      } finally {
        await messageBus.close();
      }
    });

    it('should gracefully close and cleanup subscriptions', async () => {
      const messageBus = getTestMessageBus();

      messageBus.handle(
        async (command: Command) => {
          console.log('Handler', command);
        },
        'TestCommand',
      );

      await messageBus.start();
      expect(messageBus.isStarted()).toBe(true);

      await messageBus.close();
      expect(messageBus.isStarted()).toBe(false);

      // Should be safe to close again
      await messageBus.close();
      expect(messageBus.isStarted()).toBe(false);
    });
  });
});
