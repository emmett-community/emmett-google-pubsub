// Global test setup

// Increase timeout for tests that hit external resources (e.g., emulators).
jest.setTimeout(30000);

// BigInt serialization support for Jest.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (
  this: bigint,
) {
  return this.toString();
};
