import { safeLog } from '../../src/messageBus/observability';
import type { Logger } from '../../src/messageBus/types';

describe('Observability', () => {
  describe('safeLog', () => {
    it('should not throw when logger is undefined', () => {
      expect(() => {
        safeLog.debug(undefined, 'test message');
        safeLog.info(undefined, 'test message');
        safeLog.warn(undefined, 'test message');
        safeLog.error(undefined, 'test message');
      }).not.toThrow();
    });

    it('should not throw when logger is undefined and data is provided', () => {
      expect(() => {
        safeLog.debug(undefined, 'test message', { key: 'value' });
        safeLog.info(undefined, 'test message', { key: 'value' });
        safeLog.warn(undefined, 'test message', { key: 'value' });
        safeLog.error(undefined, 'test message', new Error('test'));
      }).not.toThrow();
    });

    it('should call logger.debug with (context, message) format', () => {
      const debugMock = jest.fn();
      const logger: Logger = {
        debug: debugMock,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.debug(logger, 'debug message', { data: 1 });

      expect(debugMock).toHaveBeenCalledWith({ data: 1 }, 'debug message');
    });

    it('should call logger.info with (context, message) format', () => {
      const infoMock = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: infoMock,
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.info(logger, 'info message', { data: 2 });

      expect(infoMock).toHaveBeenCalledWith({ data: 2 }, 'info message');
    });

    it('should call logger.warn with (context, message) format', () => {
      const warnMock = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: warnMock,
        error: jest.fn(),
      };

      safeLog.warn(logger, 'warn message', { data: 3 });

      expect(warnMock).toHaveBeenCalledWith({ data: 3 }, 'warn message');
    });

    it('should call logger.error with { err: error } context', () => {
      const errorMock = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorMock,
      };
      const testError = new Error('test error');

      safeLog.error(logger, 'error message', testError);

      expect(errorMock).toHaveBeenCalledWith({ err: testError }, 'error message');
    });

    it('should handle undefined data parameter with empty object', () => {
      const infoMock = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: infoMock,
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.info(logger, 'message without data');

      expect(infoMock).toHaveBeenCalledWith({}, 'message without data');
    });

    it('should wrap primitive data in { data: value }', () => {
      const debugMock = jest.fn();
      const logger: Logger = {
        debug: debugMock,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.debug(logger, 'primitive data', 'string value');

      expect(debugMock).toHaveBeenCalledWith({ data: 'string value' }, 'primitive data');
    });

    it('should wrap array data in { data: value }', () => {
      const debugMock = jest.fn();
      const logger: Logger = {
        debug: debugMock,
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.debug(logger, 'array data', [1, 2, 3]);

      expect(debugMock).toHaveBeenCalledWith({ data: [1, 2, 3] }, 'array data');
    });

    it('should handle null data as empty object', () => {
      const infoMock = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: infoMock,
        warn: jest.fn(),
        error: jest.fn(),
      };

      safeLog.info(logger, 'null data', null);

      expect(infoMock).toHaveBeenCalledWith({}, 'null data');
    });

    it('should handle null error as empty object', () => {
      const errorMock = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorMock,
      };

      safeLog.error(logger, 'null error', null);

      expect(errorMock).toHaveBeenCalledWith({}, 'null error');
    });

    it('should always use err key for error context regardless of error type', () => {
      const errorMock = jest.fn();
      const logger: Logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: errorMock,
      };

      // Object error
      safeLog.error(logger, 'object error', { code: 'ERR_001' });
      expect(errorMock).toHaveBeenCalledWith({ err: { code: 'ERR_001' } }, 'object error');

      // String error
      safeLog.error(logger, 'string error', 'some error');
      expect(errorMock).toHaveBeenCalledWith({ err: 'some error' }, 'string error');
    });
  });
});
