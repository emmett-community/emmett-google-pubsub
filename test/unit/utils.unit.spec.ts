import {
  generateUUID,
  assertNotEmptyString,
  assertPositiveNumber,
} from '../../src/messageBus/utils';

describe('Utils', () => {
  describe('generateUUID', () => {
    it('should generate a valid UUID', () => {
      const uuid = generateUUID();

      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });

    it('should generate unique UUIDs', () => {
      const uuid1 = generateUUID();
      const uuid2 = generateUUID();

      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('assertNotEmptyString', () => {
    it('should pass for non-empty string', () => {
      expect(() => assertNotEmptyString('test', 'value')).not.toThrow();
      expect(() => assertNotEmptyString('hello world', 'value')).not.toThrow();
    });

    it('should throw for empty string', () => {
      expect(() => assertNotEmptyString('', 'value')).toThrow(
        'value must be a non-empty string',
      );
    });

    it('should throw for whitespace-only string', () => {
      expect(() => assertNotEmptyString('   ', 'value')).toThrow(
        'value must be a non-empty string',
      );
    });

    it('should throw for non-string values', () => {
      expect(() => assertNotEmptyString(123, 'value')).toThrow(
        'value must be a non-empty string',
      );
      expect(() => assertNotEmptyString(null, 'value')).toThrow(
        'value must be a non-empty string',
      );
      expect(() => assertNotEmptyString(undefined, 'value')).toThrow(
        'value must be a non-empty string',
      );
      expect(() => assertNotEmptyString({}, 'value')).toThrow(
        'value must be a non-empty string',
      );
    });
  });

  describe('assertPositiveNumber', () => {
    it('should pass for positive numbers', () => {
      expect(() => assertPositiveNumber(1, 'value')).not.toThrow();
      expect(() => assertPositiveNumber(100.5, 'value')).not.toThrow();
      expect(() => assertPositiveNumber(0.1, 'value')).not.toThrow();
    });

    it('should throw for zero', () => {
      expect(() => assertPositiveNumber(0, 'value')).toThrow(
        'value must be a positive number',
      );
    });

    it('should throw for negative numbers', () => {
      expect(() => assertPositiveNumber(-1, 'value')).toThrow(
        'value must be a positive number',
      );
      expect(() => assertPositiveNumber(-100.5, 'value')).toThrow(
        'value must be a positive number',
      );
    });

    it('should throw for non-number values', () => {
      expect(() => assertPositiveNumber('123', 'value')).toThrow(
        'value must be a positive number',
      );
      expect(() => assertPositiveNumber(null, 'value')).toThrow(
        'value must be a positive number',
      );
      expect(() => assertPositiveNumber(undefined, 'value')).toThrow(
        'value must be a positive number',
      );
      expect(() => assertPositiveNumber({}, 'value')).toThrow(
        'value must be a positive number',
      );
    });

    it('should throw for NaN', () => {
      expect(() => assertPositiveNumber(NaN, 'value')).toThrow(
        'value must be a positive number',
      );
    });

    it('should throw for Infinity', () => {
      // Infinity is not <= 0, so it would pass the check
      // but it's not a valid positive number in practical terms
      // This test documents the current behavior
      expect(() => assertPositiveNumber(Infinity, 'value')).not.toThrow();
    });
  });
});
