// Global test setup

// Increase timeout for tests that hit external resources (e.g., emulators).
jest.setTimeout(30000);

// BigInt serialization support for Jest.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
