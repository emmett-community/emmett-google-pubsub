import type { Logger } from './types';

/**
 * @internal - NOT part of public API
 * Normalizes data to a context object for the Logger contract.
 */
function normalizeContext(data: unknown): Record<string, unknown> {
  if (data === undefined || data === null) return {};
  if (typeof data === 'object' && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>) };
  }
  return { data };
}

/**
 * @internal - NOT part of public API
 * Normalizes error data to a context object for the Logger contract.
 * ALWAYS uses 'err' key - no exceptions.
 */
function normalizeErrorContext(error: unknown): Record<string, unknown> {
  if (error === undefined || error === null) return {};
  return { err: error };
}

/**
 * @internal - NOT part of public API
 *
 * Internal helper for ergonomic logging within this package.
 * Translates internal (msg, data) calls to canonical (context, message) contract.
 *
 * This is the ONLY point where translation from internal format to contract format occurs.
 *
 * @example
 * // Internal usage
 * safeLog.info(logger, 'Order created', { orderId: 123 })
 *
 * // Translates to Logger contract call
 * logger.info({ orderId: 123 }, 'Order created')
 */
const safeLog = {
  debug: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.debug(normalizeContext(data), msg);
  },
  info: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.info(normalizeContext(data), msg);
  },
  warn: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.warn(normalizeContext(data), msg);
  },
  error: (logger: Logger | undefined, msg: string, error?: unknown): void => {
    if (!logger) return;
    logger.error(normalizeErrorContext(error), msg);
  },
};

export { safeLog };
