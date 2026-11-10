import { randomUUID as cryptoRandomUUID } from 'crypto';

/**
 * Generate a random UUID
 */
export function generateUUID(): string {
  return cryptoRandomUUID();
}

/**
 * Whether an error of the Pub/Sub client is NOT_FOUND (gRPC code 5)
 */
export function isNotFound(error: unknown): boolean {
  return (error as { code?: number } | undefined)?.code === 5;
}

/**
 * Validate that a string is not empty
 */
export function assertNotEmptyString(
  value: unknown,
  name: string,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
}

/**
 * Validate that a number is positive
 */
export function assertPositiveNumber(
  value: unknown,
  name: string,
): asserts value is number {
  if (typeof value !== 'number' || value <= 0 || Number.isNaN(value)) {
    throw new Error(`${name} must be a positive number`);
  }
}
