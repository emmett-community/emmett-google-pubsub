// Global test setup
jest.setTimeout(30000);

// BigInt serialization support for Jest
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

// PubSub emulator environment setup
process.env.PUBSUB_PROJECT_ID = process.env.PUBSUB_PROJECT_ID || 'test-project';
process.env.PUBSUB_EMULATOR_HOST =
  process.env.PUBSUB_EMULATOR_HOST || 'localhost:8085';

beforeAll(() => {
  // Setup code if needed
});

afterAll(() => {
  // Cleanup code if needed
});
