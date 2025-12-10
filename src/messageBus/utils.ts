import { randomUUID as cryptoRandomUUID } from 'crypto';

/**
 * Generate a random UUID
 */
export function generateUUID(): string {
  return cryptoRandomUUID();
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
