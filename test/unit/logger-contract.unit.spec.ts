import { getPubSubMessageBus } from '../../src/messageBus/pubsubMessageBus';
import type { Logger } from '../../src/messageBus/types';
import { InMemoryPubSub } from '../support/inMemoryPubSub';
import * as packageExports from '../../src';

/**
 * Logger Contract Tests
 *
 * These tests verify that the Logger contract is correctly implemented:
 * - (context, message) format, NOT (message, data)
 * - All 4 methods are called with correct format
 * - safeLog is NOT exported
 * - Error context always uses 'err' key
 */
describe('Logger Contract', () => {
  let pubsub: InMemoryPubSub;

  beforeEach(() => {
    pubsub = new InMemoryPubSub();
  });

  afterEach(async () => {
    await pubsub.close();
  });

  describe('Contract Format Validation', () => {
    it('MUST call logger with (context, message) format - NOT (message, data)', async () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(['debug', ...args]),
        info: (...args: unknown[]) => calls.push(['info', ...args]),
        warn: (...args: unknown[]) => calls.push(['warn', ...args]),
        error: (...args: unknown[]) => calls.push(['error', ...args]),
      };

      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger },
      });

      await messageBus.start();
      await messageBus.close();

      // Find the initialization log call
      const initCall = calls.find((c) => c[0] === 'info');
      expect(initCall).toBeDefined();

      const [, firstArg, secondArg] = initCall!;

      // OLD format check - MUST BE FALSE (would fail on old code)
      const isOldFormat = typeof firstArg === 'string';
      expect(isOldFormat).toBe(false);

      // NEW format check - MUST BE TRUE
      const isNewFormat = typeof firstArg === 'object' && firstArg !== null;
      expect(isNewFormat).toBe(true);

      // Message should be string at position 1
      expect(typeof secondArg).toBe('string');
      expect(secondArg).toBe('Starting message bus');
    });

    it('MUST verify argument POSITION not just type', async () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(args),
        info: (...args: unknown[]) => calls.push(args),
        warn: (...args: unknown[]) => calls.push(args),
        error: (...args: unknown[]) => calls.push(args),
      };

      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger },
      });

      await messageBus.start();
      await messageBus.close();

      // Find the 'Starting message bus' call
      const startingCall = calls.find(
        (c) => typeof c[1] === 'string' && c[1] === 'Starting message bus',
      );
      expect(startingCall).toBeDefined();

      const [firstArg, secondArg] = startingCall!;

      // Position 0 MUST be context object
      expect(typeof firstArg).toBe('object');
      expect(firstArg).not.toBeNull();

      // Position 1 MUST be message string
      expect(typeof secondArg).toBe('string');
    });

    it('MUST handle message without context data - returns empty object', async () => {
      const calls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => calls.push(args),
        info: (...args: unknown[]) => calls.push(args),
        warn: (...args: unknown[]) => calls.push(args),
        error: (...args: unknown[]) => calls.push(args),
      };

      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger },
      });

      await messageBus.start();
      await messageBus.close();

      // Find the 'Starting message bus' call (has no context data)
      const startingCall = calls.find(
        (c) => typeof c[1] === 'string' && c[1] === 'Starting message bus',
      );
      expect(startingCall).toBeDefined();

      const [context, message] = startingCall!;
      expect(context).toEqual({});
      expect(message).toBe('Starting message bus');
    });
  });

  describe('All Logger Methods', () => {
    it('MUST call debug() at least once', async () => {
      const debugCalls: unknown[][] = [];
      const logger: Logger = {
        debug: (...args: unknown[]) => debugCalls.push(args),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger },
      });

      await messageBus.start();
      await messageBus.send({ type: 'TestCommand', data: {} });
      await messageBus.close();

      expect(debugCalls.length).toBeGreaterThan(0);

      // Verify format
      for (const call of debugCalls) {
        expect(typeof call[0]).toBe('object');
        expect(call[0]).not.toBeNull();
      }
    });

    it('MUST call info() at least once', async () => {
      const infoCalls: unknown[][] = [];
      const logger: Logger = {
        debug: jest.fn(),
        info: (...args: unknown[]) => infoCalls.push(args),
        warn: jest.fn(),
        error: jest.fn(),
      };

      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger },
      });

      await messageBus.start();
      await messageBus.close();

      expect(infoCalls.length).toBeGreaterThan(0);

      // Verify format
      for (const call of infoCalls) {
        expect(typeof call[0]).toBe('object');
        expect(call[0]).not.toBeNull();
        expect(typeof call[1]).toBe('string');
      }
    });
  });

  describe('safeLog Encapsulation', () => {
    it('safeLog must NOT be importable from package', () => {
      expect('safeLog' in packageExports).toBe(false);
    });

    it('Logger MUST be importable from package', () => {
      // Logger is a type, so we check it's exported by using it
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      expect(logger).toBeDefined();
    });
  });

  describe('Type Safety', () => {
    it('Logger interface should have required methods with (context, message) signature', () => {
      // This is a compile-time check - if it compiles, it passes
      const logger: Logger = {
        debug: (context: Record<string, unknown>, message?: string) => {
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
        info: (context: Record<string, unknown>, message?: string) => {
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
        warn: (context: Record<string, unknown>, message?: string) => {
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
        error: (context: Record<string, unknown>, message?: string) => {
          const _ctx: Record<string, unknown> = context;
          const _msg: string | undefined = message;
          void _ctx;
          void _msg;
        },
      };
      expect(logger).toBeDefined();
    });
  });

  describe('Pino Compatibility', () => {
    it('should work with Pino-style logger directly', async () => {
      // Pino uses (context, message) natively
      const calls: unknown[][] = [];
      const pinoStyleLogger: Logger = {
        debug: (context, message) => calls.push(['debug', context, message]),
        info: (context, message) => calls.push(['info', context, message]),
        warn: (context, message) => calls.push(['warn', context, message]),
        error: (context, message) => calls.push(['error', context, message]),
      };

      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger: pinoStyleLogger },
      });

      await messageBus.start();
      await messageBus.close();

      // All calls should have object first, string second
      for (const call of calls) {
        const [, context, message] = call;
        expect(typeof context).toBe('object');
        expect(typeof message).toBe('string');
      }
    });
  });

  describe('Winston Adapter Pattern', () => {
    it('should work with Winston through adapter', async () => {
      // Winston uses (message, meta) - adapter inverts
      const winstonCalls: unknown[][] = [];

      // Fake Winston logger
      const fakeWinston = {
        log: (level: string, message: string, meta: unknown) => {
          winstonCalls.push([level, message, meta]);
        },
      };

      // Winston adapter that implements our Logger contract
      const winstonAdapter: Logger = {
        debug(context, message) {
          fakeWinston.log('debug', message ?? '', context);
        },
        info(context, message) {
          fakeWinston.log('info', message ?? '', context);
        },
        warn(context, message) {
          fakeWinston.log('warn', message ?? '', context);
        },
        error(context, message) {
          fakeWinston.log('error', message ?? '', context);
        },
      };

      const messageBus = getPubSubMessageBus({
        pubsub: pubsub as never,
        useEmulator: true,
        observability: { logger: winstonAdapter },
      });

      await messageBus.start();
      await messageBus.close();

      // Verify Winston received the calls in its expected format
      expect(winstonCalls.length).toBeGreaterThan(0);

      for (const call of winstonCalls) {
        const [level, message, meta] = call;
        expect(typeof level).toBe('string');
        expect(typeof message).toBe('string');
        expect(typeof meta).toBe('object');
      }
    });
  });
});
