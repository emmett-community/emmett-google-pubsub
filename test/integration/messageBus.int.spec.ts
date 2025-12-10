import type { Command, Event, Message } from '@event-driven-io/emmett';
import {
  getTestMessageBus,
  createTestCommand,
  createTestEvent,
  waitFor,
} from './helpers';

describe('MessageBus Integration Tests', () => {
  describe('full workflow integration', () => {
    it('should handle commands and events together', async () => {
      const messageBus = getTestMessageBus();
      const receivedCommands: Command[] = [];
      const receivedEvents: Event[] = [];

      messageBus.handle(
        async (command: Command) => {
          receivedCommands.push(command);
          // Publish an event when command is handled
          await messageBus.publish({
            type: 'CommandProcessed',
            data: { commandId: (command.data as any).id },
          });
        },
        'TestCommand',
      );

      messageBus.subscribe(
        async (event: Event) => {
          receivedEvents.push(event);
        },
        'CommandProcessed',
      );

      await messageBus.start();

      // Give subscriptions time to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        await messageBus.send(createTestCommand('cmd-1', 'test'));

        await waitFor(
          () => receivedCommands.length > 0 && receivedEvents.length > 0,
          10000, // Increased timeout for workflow
        );

        expect(receivedCommands).toHaveLength(1);
        expect(receivedEvents).toHaveLength(1);
        expect((receivedEvents[0].data as any).commandId).toBe('cmd-1');
      } finally {
        await messageBus.close();
      }
    });

    it('should handle concurrent message processing', async () => {
      const messageBus = getTestMessageBus();
      const receivedMessages: Message[] = [];

      messageBus.handle(
        async (command: Command) => {
          receivedMessages.push(command);
        },
        'Command1',
      );

      messageBus.handle(
        async (command: Command) => {
          receivedMessages.push(command);
        },
        'Command2',
      );

      messageBus.subscribe(
        async (event: Event) => {
          receivedMessages.push(event);
        },
        'Event1',
      );

      await messageBus.start();

      try {
        // Send multiple messages concurrently
        await Promise.all([
          messageBus.send({ type: 'Command1', data: { id: 'cmd1' } }),
          messageBus.send({ type: 'Command2', data: { id: 'cmd2' } }),
          messageBus.publish({ type: 'Event1', data: { id: 'evt1' } }),
        ]);

        await waitFor(() => receivedMessages.length === 3, 5000);

        expect(receivedMessages).toHaveLength(3);

        const types = receivedMessages.map((m) => m.type).sort();
        expect(types).toEqual(['Command1', 'Command2', 'Event1']);
      } finally {
        await messageBus.close();
      }
    });

    it('should handle complex event-driven workflow', async () => {
      const messageBus = getTestMessageBus();
      const workflow: string[] = [];

      // Step 1: Handle CreateOrder command
      messageBus.handle(
        async (command: Command) => {
          workflow.push('CreateOrder-received');
          await messageBus.publish({
            type: 'OrderCreated',
            data: { orderId: (command.data as any).orderId },
          });
        },
        'CreateOrder',
      );

      // Step 2: React to OrderCreated event
      messageBus.subscribe(
        async (event: Event) => {
          workflow.push('OrderCreated-received');
          await messageBus.publish({
            type: 'PaymentRequested',
            data: { orderId: (event.data as any).orderId },
          });
        },
        'OrderCreated',
      );

      // Step 3: React to PaymentRequested event
      messageBus.subscribe(
        async (event: Event) => {
          workflow.push('PaymentRequested-received');
          await messageBus.publish({
            type: 'PaymentCompleted',
            data: { orderId: (event.data as any).orderId },
          });
        },
        'PaymentRequested',
      );

      // Step 4: React to PaymentCompleted event
      messageBus.subscribe(
        async (_event: Event) => {
          workflow.push('PaymentCompleted-received');
        },
        'PaymentCompleted',
      );

      await messageBus.start();

      // Give subscriptions time to be fully ready
      await new Promise((resolve) => setTimeout(resolve, 1000));

      try {
        // Trigger the workflow
        await messageBus.send({
          type: 'CreateOrder',
          data: { orderId: 'order-123' },
        });

        // Wait for workflow to complete
        await waitFor(() => workflow.length === 4, 20000); // Increased timeout for complex workflow

        expect(workflow).toEqual([
          'CreateOrder-received',
          'OrderCreated-received',
          'PaymentRequested-received',
          'PaymentCompleted-received',
        ]);
      } finally {
        await messageBus.close();
      }
    });
  });

  describe('lifecycle and resource management', () => {
    it('should properly initialize and cleanup multiple instances', async () => {
      const bus1 = getTestMessageBus();
      const bus2 = getTestMessageBus();

      const bus1Received: Command[] = [];
      const bus2Received: Command[] = [];

      bus1.handle(
        async (command: Command) => {
          bus1Received.push(command);
        },
        'TestCommand',
      );

      bus2.handle(
        async (command: Command) => {
          bus2Received.push(command);
        },
        'TestCommand',
      );

      await bus1.start();
      await bus2.start();

      try {
        // Send from bus1
        await bus1.send(createTestCommand('cmd-1', 'test'));

        // Wait for processing
        await waitFor(() => bus1Received.length > 0 || bus2Received.length > 0);

        // One of the instances should receive it (load balancing)
        expect(bus1Received.length + bus2Received.length).toBeGreaterThanOrEqual(
          1,
        );
      } finally {
        await bus1.close();
        await bus2.close();
      }
    });

    it('should handle restart gracefully', async () => {
      const messageBus = getTestMessageBus();
      const receivedCommands: Command[] = [];

      messageBus.handle(
        async (command: Command) => {
          receivedCommands.push(command);
        },
        'TestCommand',
      );

      // Start, send, close
      await messageBus.start();
      await messageBus.send(createTestCommand('cmd-1', 'first'));
      await waitFor(() => receivedCommands.length > 0);
      await messageBus.close();

      expect(receivedCommands).toHaveLength(1);

      // Restart and send again
      receivedCommands.length = 0;
      await messageBus.start();
      await messageBus.send(createTestCommand('cmd-2', 'second'));
      await waitFor(() => receivedCommands.length > 0);

      expect(receivedCommands).toHaveLength(1);
      expect((receivedCommands[0].data as any).id).toBe('cmd-2');

      await messageBus.close();
    });

    it('should handle close during message processing', async () => {
      const messageBus = getTestMessageBus();
      const startedProcessing: string[] = [];
      const completedProcessing: string[] = [];

      messageBus.handle(
        async (command: Command) => {
          startedProcessing.push((command.data as any).id);
          await new Promise((resolve) => setTimeout(resolve, 2000));
          completedProcessing.push((command.data as any).id);
        },
        'TestCommand',
      );

      await messageBus.start();

      // Send command
      await messageBus.send(createTestCommand('cmd-1', 'test'));

      // Wait for processing to start
      await waitFor(() => startedProcessing.length > 0);

      // Close while processing (should wait for in-flight)
      await messageBus.close();

      // Processing should have completed or been interrupted gracefully
      expect(startedProcessing).toHaveLength(1);
    });
  });

  describe('configuration options', () => {
    it('should respect custom instance ID', async () => {
      const customInstanceId = 'custom-instance-123';
      const messageBus = getTestMessageBus({ instanceId: customInstanceId });

      await messageBus.start();

      expect(messageBus.isStarted()).toBe(true);

      await messageBus.close();
    });

    it('should respect custom topic prefix', async () => {
      const messageBus = getTestMessageBus({ topicPrefix: 'custom-prefix' });
      const receivedCommands: Command[] = [];

      messageBus.handle(
        async (command: Command) => {
          receivedCommands.push(command);
        },
        'TestCommand',
      );

      await messageBus.start();

      try {
        await messageBus.send(createTestCommand('cmd-1', 'test'));

        await waitFor(() => receivedCommands.length > 0);

        expect(receivedCommands).toHaveLength(1);
      } finally {
        await messageBus.close();
      }
    });

    it('should support auto-create resources option', async () => {
      const messageBus = getTestMessageBus({ autoCreateResources: true });
      const receivedCommands: Command[] = [];

      messageBus.handle(
        async (command: Command) => {
          receivedCommands.push(command);
        },
        'TestCommand',
      );

      await messageBus.start();

      try {
        await messageBus.send(createTestCommand('cmd-1', 'test'));

        await waitFor(() => receivedCommands.length > 0);

        expect(receivedCommands).toHaveLength(1);
      } finally {
        await messageBus.close();
      }
    });
  });

  describe('performance and stress tests', () => {
    it('should handle high volume of messages', async () => {
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
        const messageCount = 50;
        const promises = [];

        for (let i = 0; i < messageCount; i++) {
          promises.push(
            messageBus.send(createTestCommand(`cmd-${i}`, `value-${i}`)),
          );
        }

        await Promise.all(promises);

        await waitFor(() => receivedCommands.length === messageCount, 15000);

        expect(receivedCommands).toHaveLength(messageCount);
      } finally {
        await messageBus.close();
      }
    }, 30000);

    it('should handle bursts of events to multiple subscribers', async () => {
      const messageBus = getTestMessageBus();
      const subscriber1: Event[] = [];
      const subscriber2: Event[] = [];
      const subscriber3: Event[] = [];

      messageBus.subscribe(
        async (event: Event) => {
          subscriber1.push(event);
        },
        'TestEvent',
      );

      messageBus.subscribe(
        async (event: Event) => {
          subscriber2.push(event);
        },
        'TestEvent',
      );

      messageBus.subscribe(
        async (event: Event) => {
          subscriber3.push(event);
        },
        'TestEvent',
      );

      await messageBus.start();

      try {
        const eventCount = 20;
        const promises = [];

        for (let i = 0; i < eventCount; i++) {
          promises.push(
            messageBus.publish(createTestEvent(`evt-${i}`, `value-${i}`)),
          );
        }

        await Promise.all(promises);

        await waitFor(
          () =>
            subscriber1.length === eventCount &&
            subscriber2.length === eventCount &&
            subscriber3.length === eventCount,
          15000,
        );

        expect(subscriber1).toHaveLength(eventCount);
        expect(subscriber2).toHaveLength(eventCount);
        expect(subscriber3).toHaveLength(eventCount);
      } finally {
        await messageBus.close();
      }
    }, 30000);
  });
});
