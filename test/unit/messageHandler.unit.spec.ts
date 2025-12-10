import type { Message as PubSubMessage, Subscription } from '@google-cloud/pubsub';
import type {
  AnyMessage,
  Command,
  Event,
  SingleRawMessageHandlerWithoutContext,
} from '@event-driven-io/emmett';
import { EmmettError } from '@event-driven-io/emmett';
import {
  shouldRetry,
  handleCommandMessage,
  handleEventMessage,
  createMessageListener,
} from '../../src/messageBus/messageHandler';
import { serialize } from '../../src/messageBus/serialization';

describe('MessageHandler', () => {
  describe('shouldRetry', () => {
    it('should return true for network errors', () => {
      const error = new Error('Network error occurred');
      expect(shouldRetry(error)).toBe(true);
    });

    it('should return true for timeout errors', () => {
      const error = new Error('Request timeout');
      expect(shouldRetry(error)).toBe(true);
    });

    it('should return true for ECONNREFUSED errors', () => {
      const error = new Error('ECONNREFUSED');
      expect(shouldRetry(error)).toBe(true);
    });

    it('should return true for unavailable errors', () => {
      const error = new Error('Service unavailable');
      expect(shouldRetry(error)).toBe(true);
    });

    it('should return false for EmmettError', () => {
      const error = new EmmettError('Business logic error');
      expect(shouldRetry(error)).toBe(false);
    });

    it('should return false for validation errors', () => {
      const error = new Error('Validation failed');
      expect(shouldRetry(error)).toBe(false);
    });

    it('should return false for invalid errors', () => {
      const error = new Error('Invalid input');
      expect(shouldRetry(error)).toBe(false);
    });

    it('should return false for not found errors', () => {
      const error = new Error('Resource not found');
      expect(shouldRetry(error)).toBe(false);
    });

    it('should return true for unknown error types', () => {
      const error = 'Unknown error';
      expect(shouldRetry(error)).toBe(true);
    });

    it('should return true for unknown Error instances', () => {
      const error = new Error('Something went wrong');
      expect(shouldRetry(error)).toBe(true);
    });
  });

  describe('handleCommandMessage', () => {
    const createMockMessage = (command: Command): PubSubMessage => {
      const buffer = serialize(command);
      return {
        data: buffer,
        deliveryAttempt: 1,
        ack: jest.fn(),
        nack: jest.fn(),
      } as unknown as PubSubMessage;
    };

    it('should execute command handler and return ack on success', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestCommand', [handler]]]);

      const command: Command = {
        type: 'TestCommand',
        data: { value: 'test' },
      };
      const message = createMockMessage(command);

      const result = await handleCommandMessage(
        message,
        handlers,
        'TestCommand',
      );

      expect(result).toBe('ack');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TestCommand',
          data: { value: 'test' },
        }),
      );
    });

    it('should return ack when handler throws EmmettError', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const handler = jest
        .fn()
        .mockRejectedValue(new EmmettError('Business error'));
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestCommand', [handler]]]);

      const command: Command = {
        type: 'TestCommand',
        data: { value: 'test' },
      };
      const message = createMockMessage(command);

      const result = await handleCommandMessage(
        message,
        handlers,
        'TestCommand',
      );

      expect(result).toBe('ack');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should return nack when handler throws network error', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation();
      const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();

      const handler = jest.fn().mockRejectedValue(new Error('Network error'));
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestCommand', [handler]]]);

      const command: Command = {
        type: 'TestCommand',
        data: { value: 'test' },
      };
      const message = createMockMessage(command);

      const result = await handleCommandMessage(
        message,
        handlers,
        'TestCommand',
      );

      expect(result).toBe('nack');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleInfoSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    });

    it('should throw EmmettError when no handler registered', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >();

      const command: Command = {
        type: 'TestCommand',
        data: { value: 'test' },
      };
      const message = createMockMessage(command);

      const result = await handleCommandMessage(
        message,
        handlers,
        'TestCommand',
      );

      expect(result).toBe('ack'); // Acked because it's a permanent error
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should throw EmmettError when multiple handlers registered', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const handler1 = jest.fn().mockResolvedValue(undefined);
      const handler2 = jest.fn().mockResolvedValue(undefined);
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestCommand', [handler1, handler2]]]);

      const command: Command = {
        type: 'TestCommand',
        data: { value: 'test' },
      };
      const message = createMockMessage(command);

      const result = await handleCommandMessage(
        message,
        handlers,
        'TestCommand',
      );

      expect(result).toBe('ack'); // Acked because it's a permanent error
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('handleEventMessage', () => {
    const createMockMessage = (event: Event): PubSubMessage => {
      const buffer = serialize(event);
      return {
        data: buffer,
        deliveryAttempt: 1,
        ack: jest.fn(),
        nack: jest.fn(),
      } as unknown as PubSubMessage;
    };

    it('should execute all event handlers and return ack on success', async () => {
      const handler1 = jest.fn().mockResolvedValue(undefined);
      const handler2 = jest.fn().mockResolvedValue(undefined);
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestEvent', [handler1, handler2]]]);

      const event: Event = {
        type: 'TestEvent',
        data: { value: 'test' },
      };
      const message = createMockMessage(event);

      const result = await handleEventMessage(message, handlers, 'TestEvent');

      expect(result).toBe('ack');
      expect(handler1).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TestEvent',
          data: { value: 'test' },
        }),
      );
      expect(handler2).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TestEvent',
          data: { value: 'test' },
        }),
      );
    });

    it('should return ack when no handlers registered', async () => {
      const consoleDebugSpy = jest
        .spyOn(console, 'debug')
        .mockImplementation();

      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >();

      const event: Event = {
        type: 'TestEvent',
        data: { value: 'test' },
      };
      const message = createMockMessage(event);

      const result = await handleEventMessage(message, handlers, 'TestEvent');

      expect(result).toBe('ack');
      expect(consoleDebugSpy).toHaveBeenCalled();

      consoleDebugSpy.mockRestore();
    });

    it('should return nack when handler throws retriable error', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation();
      const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();

      const handler = jest.fn().mockRejectedValue(new Error('Network error'));
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestEvent', [handler]]]);

      const event: Event = {
        type: 'TestEvent',
        data: { value: 'test' },
      };
      const message = createMockMessage(event);

      const result = await handleEventMessage(message, handlers, 'TestEvent');

      expect(result).toBe('nack');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleInfoSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    });

    it('should continue processing when handler throws non-retriable error', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const handler1 = jest
        .fn()
        .mockRejectedValue(new EmmettError('Business error'));
      const handler2 = jest.fn().mockResolvedValue(undefined);
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestEvent', [handler1, handler2]]]);

      const event: Event = {
        type: 'TestEvent',
        data: { value: 'test' },
      };
      const message = createMockMessage(event);

      const result = await handleEventMessage(message, handlers, 'TestEvent');

      expect(result).toBe('ack');
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it('should execute handlers sequentially', async () => {
      const executionOrder: number[] = [];
      const handler1 = jest.fn().mockImplementation(async () => {
        executionOrder.push(1);
      });
      const handler2 = jest.fn().mockImplementation(async () => {
        executionOrder.push(2);
      });
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestEvent', [handler1, handler2]]]);

      const event: Event = {
        type: 'TestEvent',
        data: { value: 'test' },
      };
      const message = createMockMessage(event);

      await handleEventMessage(message, handlers, 'TestEvent');

      expect(executionOrder).toEqual([1, 2]);
    });
  });

  describe('createMessageListener', () => {
    it('should create message listener for commands', () => {
      const mockOn = jest.fn();
      const mockSubscription = {
        on: mockOn,
      } as unknown as Subscription;

      const handler = jest.fn().mockResolvedValue(undefined);
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestCommand', [handler]]]);

      createMessageListener(
        mockSubscription,
        'TestCommand',
        'command',
        handlers,
      );

      expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should create message listener for events', () => {
      const mockOn = jest.fn();
      const mockSubscription = {
        on: mockOn,
      } as unknown as Subscription;

      const handler = jest.fn().mockResolvedValue(undefined);
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestEvent', [handler]]]);

      createMessageListener(mockSubscription, 'TestEvent', 'event', handlers);

      expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('should ack message on successful handling', async () => {
      const mockAck = jest.fn();
      const mockNack = jest.fn();
      const mockOn = jest.fn();
      const mockSubscription = {
        on: mockOn,
      } as unknown as Subscription;

      const handler = jest.fn().mockResolvedValue(undefined);
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestCommand', [handler]]]);

      createMessageListener(
        mockSubscription,
        'TestCommand',
        'command',
        handlers,
      );

      const command: Command = {
        type: 'TestCommand',
        data: { value: 'test' },
      };
      const buffer = serialize(command);
      const mockMessage = {
        data: buffer,
        deliveryAttempt: 1,
        ack: mockAck,
        nack: mockNack,
      } as unknown as PubSubMessage;

      const messageHandler = mockOn.mock.calls[0][1];
      await messageHandler(mockMessage);

      expect(mockAck).toHaveBeenCalled();
      expect(mockNack).not.toHaveBeenCalled();
    });

    it('should nack message on retriable error', async () => {
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation();
      const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();

      const mockAck = jest.fn();
      const mockNack = jest.fn();
      const mockOn = jest.fn();
      const mockSubscription = {
        on: mockOn,
      } as unknown as Subscription;

      const handler = jest.fn().mockRejectedValue(new Error('Network error'));
      const handlers = new Map<
        string,
        SingleRawMessageHandlerWithoutContext<AnyMessage>[]
      >([['TestCommand', [handler]]]);

      createMessageListener(
        mockSubscription,
        'TestCommand',
        'command',
        handlers,
      );

      const command: Command = {
        type: 'TestCommand',
        data: { value: 'test' },
      };
      const buffer = serialize(command);
      const mockMessage = {
        data: buffer,
        deliveryAttempt: 1,
        ack: mockAck,
        nack: mockNack,
      } as unknown as PubSubMessage;

      const messageHandler = mockOn.mock.calls[0][1];
      await messageHandler(mockMessage);

      expect(mockNack).toHaveBeenCalled();
      expect(mockAck).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    });
  });
});
