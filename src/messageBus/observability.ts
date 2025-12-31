import type { Logger } from './types';

/**
 * Internal helper to safely call logger methods.
 * Always use: safeLog.error(logger, msg, error) - never { error }
 */
export const safeLog = {
  debug: (logger: Logger | undefined, msg: string, data?: unknown) =>
    logger?.debug?.(msg, data),
  info: (logger: Logger | undefined, msg: string, data?: unknown) =>
    logger?.info?.(msg, data),
  warn: (logger: Logger | undefined, msg: string, data?: unknown) =>
    logger?.warn?.(msg, data),
  error: (logger: Logger | undefined, msg: string, error?: unknown) =>
    logger?.error?.(msg, error),
};
