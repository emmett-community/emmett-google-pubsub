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

    it('should call logger.debug when implemented', () => {
      const debugMock = jest.fn();
      const logger: Logger = { debug: debugMock };

      safeLog.debug(logger, 'debug message', { data: 1 });

      expect(debugMock).toHaveBeenCalledWith('debug message', { data: 1 });
    });

    it('should call logger.info when implemented', () => {
      const infoMock = jest.fn();
      const logger: Logger = { info: infoMock };

      safeLog.info(logger, 'info message', { data: 2 });

      expect(infoMock).toHaveBeenCalledWith('info message', { data: 2 });
    });

    it('should call logger.warn when implemented', () => {
      const warnMock = jest.fn();
      const logger: Logger = { warn: warnMock };

      safeLog.warn(logger, 'warn message', { data: 3 });

      expect(warnMock).toHaveBeenCalledWith('warn message', { data: 3 });
    });

    it('should call logger.error with Error object directly', () => {
      const errorMock = jest.fn();
      const logger: Logger = { error: errorMock };
      const testError = new Error('test error');

      safeLog.error(logger, 'error message', testError);

      expect(errorMock).toHaveBeenCalledWith('error message', testError);
    });

    it('should not throw when partial logger is used', () => {
      const partialLogger: Logger = { warn: jest.fn() };

      expect(() => {
        safeLog.debug(partialLogger, 'debug msg');
        safeLog.info(partialLogger, 'info msg');
        safeLog.warn(partialLogger, 'warn msg');
        safeLog.error(partialLogger, 'error msg');
      }).not.toThrow();

      expect(partialLogger.warn).toHaveBeenCalled();
    });

    it('should handle undefined data parameter', () => {
      const infoMock = jest.fn();
      const logger: Logger = { info: infoMock };

      safeLog.info(logger, 'message without data');

      expect(infoMock).toHaveBeenCalledWith('message without data', undefined);
    });
  });
});
