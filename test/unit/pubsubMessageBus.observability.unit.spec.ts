import { getPubSubMessageBus } from '../../src/messageBus/pubsubMessageBus';
import type { Logger } from '../../src/messageBus/types';
import { InMemoryPubSub } from '../support/inMemoryPubSub';

describe('PubSubMessageBus Observability', () => {
  describe('default behavior (no observability configured)', () => {
    it('should not emit any console output', async () => {
      const consoleSpies = {
        log: jest.spyOn(console, 'log').mockImplementation(),
        debug: jest.spyOn(console, 'debug').mockImplementation(),
        info: jest.spyOn(console, 'info').mockImplementation(),
        warn: jest.spyOn(console, 'warn').mockImplementation(),
        error: jest.spyOn(console, 'error').mockImplementation(),
      };

      const pubsub = new InMemoryPubSub();
      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
      });

      messageBus.handle(async () => {}, 'TestCommand');
      await messageBus.start();
      await messageBus.send({ type: 'TestCommand', data: {} });
      await messageBus.close();

      expect(consoleSpies.log).not.toHaveBeenCalled();
      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.info).not.toHaveBeenCalled();
      expect(consoleSpies.warn).not.toHaveBeenCalled();
      expect(consoleSpies.error).not.toHaveBeenCalled();

      Object.values(consoleSpies).forEach((spy) => spy.mockRestore());
    });

    it('should work with noop tracer (no OTel SDK)', async () => {
      const pubsub = new InMemoryPubSub();
      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
      });

      await messageBus.start();
      await messageBus.send({ type: 'TestCommand', data: {} });
      await messageBus.close();
      // No assertions needed - test passes if no errors
    });
  });

  describe('with logger configured', () => {
    it('should log lifecycle events at info level with (context, message) format', async () => {
      const infoMock = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: infoMock,
        warn: jest.fn(),
        error: jest.fn(),
      };

      const pubsub = new InMemoryPubSub();
      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger },
      });

      await messageBus.start();
      await messageBus.close();

      // Verify (context, message) format - context is first, message is second
      expect(infoMock).toHaveBeenCalledWith({}, 'Starting message bus');
      expect(infoMock).toHaveBeenCalledWith({}, 'Message bus started');
      expect(infoMock).toHaveBeenCalledWith({}, 'Closing message bus');
      expect(infoMock).toHaveBeenCalledWith({}, 'Message bus closed');
    });

    it('should never log message types, payloads, or high-cardinality data', async () => {
      const allLogs: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => allLogs.push(['debug', ...args]),
        info: (...args: unknown[]) => allLogs.push(['info', ...args]),
        warn: (...args: unknown[]) => allLogs.push(['warn', ...args]),
        error: (...args: unknown[]) => allLogs.push(['error', ...args]),
      };

      const pubsub = new InMemoryPubSub();
      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger },
      });

      const sensitiveCommand = {
        type: 'SecretCommand',
        data: { password: 'super-secret-123', apiKey: 'key-456' },
      };

      messageBus.handle(async () => {}, 'SecretCommand');
      await messageBus.start();
      await messageBus.send(sensitiveCommand);
      await messageBus.close();

      const logOutput = JSON.stringify(allLogs);
      // Must not contain message type
      expect(logOutput).not.toContain('SecretCommand');
      // Must not contain payload data
      expect(logOutput).not.toContain('super-secret-123');
      expect(logOutput).not.toContain('key-456');
      expect(logOutput).not.toContain('password');
      expect(logOutput).not.toContain('apiKey');
      // Must not contain high-cardinality data
      expect(logOutput).not.toContain('subscriptionCount');
      expect(logOutput).not.toContain('deliveryAttempt');
      expect(logOutput).not.toContain('topicName');
    });

    it('should log at debug level when publishing messages with (context, message) format', async () => {
      const debugMock = jest.fn();
      const logger: Logger = {
        debug: debugMock,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const pubsub = new InMemoryPubSub();
      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger },
      });

      await messageBus.start();
      await messageBus.send({ type: 'TestCommand', data: {} });
      await messageBus.close();

      expect(debugMock).toHaveBeenCalledWith({}, 'Publishing message');
    });

    it('should log debug when bus already started with (context, message) format', async () => {
      const debugMock = jest.fn();
      const logger: Logger = {
        debug: debugMock,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const pubsub = new InMemoryPubSub();
      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger },
      });

      await messageBus.start();
      await messageBus.start(); // Call again
      await messageBus.close();

      expect(debugMock).toHaveBeenCalledWith({}, 'Message bus already started');
    });
  });
});
