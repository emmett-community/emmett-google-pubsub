# @emmett-community/emmett-google-pubsub

Google Cloud Pub/Sub message bus implementation for [Emmett](https://event-driven-io.github.io/emmett/), the Node.js event sourcing framework.

[![npm version](https://img.shields.io/npm/v/@emmett-community/emmett-google-pubsub.svg)](https://www.npmjs.com/package/@emmett-community/emmett-google-pubsub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Distributed Message Bus** - Scale command/event handling across multiple instances
- **Type-Safe** - Full TypeScript support with comprehensive types
- **Automatic Topic Management** - Auto-creates topics and subscriptions
- **Message Scheduling** - Schedule commands/events for future execution
- **Error Handling** - Built-in retry logic and dead letter queue support
- **Emulator Support** - Local development with PubSub emulator
- **Testing Utilities** - Helper functions for easy testing
- **Emmett Compatible** - Drop-in replacement for in-memory message bus
- **Producer-Only Mode** - Use without starting consumers

## Installation

```bash
npm install @emmett-community/emmett-google-pubsub @google-cloud/pubsub
```

## Quick Start

```typescript
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';

// Initialize PubSub client
const pubsub = new PubSub({ projectId: 'your-project-id' });

// Create message bus
const messageBus = getPubSubMessageBus({ pubsub });

// Register command handler
messageBus.handle(async (command) => {
  console.log('Processing:', command.type, command.data);
}, 'AddProductItem');

// Subscribe to events
messageBus.subscribe(async (event) => {
  console.log('Received:', event.type, event.data);
}, 'ProductItemAdded');

// Start listening
await messageBus.start();

// Send commands and publish events
await messageBus.send({
  type: 'AddProductItem',
  data: { productId: '123', quantity: 2 },
});

await messageBus.publish({
  type: 'ProductItemAdded',
  data: { productId: '123', quantity: 2 },
});
```

## How It Works

### Topic/Subscription Strategy

The message bus uses a **topic-per-type** strategy:

```
Commands (1-to-1):
  Topic: {prefix}-cmd-{CommandType}
  Subscription: {prefix}-cmd-{CommandType}-{instanceId}
  → Only ONE handler processes each command

Events (1-to-many):
  Topic: {prefix}-evt-{EventType}
  Subscription: {prefix}-evt-{EventType}-{subscriberId}
  → ALL subscribers receive each event
```

**Example topic names:**

```
emmett-cmd-AddProductItem
emmett-cmd-AddProductItem-instance-abc123

emmett-evt-ProductItemAdded
emmett-evt-ProductItemAdded-subscriber-xyz789
```

### Message Lifecycle

```
1. REGISTRATION     2. STARTUP          3. RUNTIME           4. SHUTDOWN
   handle()            start()             send/publish         close()
   subscribe()         → Create topics     → Route messages     → Stop listeners
                       → Create subs       → Execute handlers   → Cleanup
                       → Attach listeners  → Ack/Nack
```

### Producer-Only Mode

You can use the message bus to only produce messages without consuming:

```typescript
const messageBus = getPubSubMessageBus({ pubsub });

// No handlers, no start() needed
await messageBus.send({ type: 'MyCommand', data: {} });
await messageBus.publish({ type: 'MyEvent', data: {} });
```

## API Reference

### `getPubSubMessageBus(config)`

Creates a message bus instance.

```typescript
const messageBus = getPubSubMessageBus({
  pubsub,                          // Required: PubSub client
  topicPrefix: 'myapp',            // Topic name prefix (default: "emmett")
  instanceId: 'worker-1',          // Instance ID (default: auto-generated)
  useEmulator: true,               // Emulator mode (default: false)
  autoCreateResources: true,       // Auto-create topics/subs (default: true)
  cleanupOnClose: false,           // Delete subs on close (default: false)
  closePubSubClient: true,         // Close PubSub on close (default: true)
  subscriptionOptions: {           // Subscription config
    ackDeadlineSeconds: 60,
    retryPolicy: {
      minimumBackoff: { seconds: 10 },
      maximumBackoff: { seconds: 600 },
    },
    deadLetterPolicy: {
      deadLetterTopic: 'projects/.../topics/dead-letters',
      maxDeliveryAttempts: 5,
    },
  },
});
```

### Methods

| Method | Description |
|--------|-------------|
| `send(command)` | Send a command (1-to-1) |
| `publish(event)` | Publish an event (1-to-many) |
| `handle(handler, ...types)` | Register command handler |
| `subscribe(handler, ...types)` | Subscribe to events |
| `schedule(message, options)` | Schedule for future delivery |
| `dequeue()` | Get scheduled messages (emulator only) |
| `start()` | Start listening for messages |
| `close()` | Graceful shutdown |
| `isStarted()` | Check if running |

See [docs/API.md](./docs/API.md) for complete API documentation.

## Configuration

### Basic Configuration

```typescript
const messageBus = getPubSubMessageBus({
  pubsub: new PubSub({ projectId: 'my-project' }),
  topicPrefix: 'orders',
});
```

### Emulator Configuration

```typescript
// Set environment variable
process.env.PUBSUB_EMULATOR_HOST = 'localhost:8085';

const pubsub = new PubSub({ projectId: 'demo-project' });
const messageBus = getPubSubMessageBus({
  pubsub,
  useEmulator: true,  // Enables in-memory scheduling
});
```

### Production Configuration

```typescript
const pubsub = new PubSub({
  projectId: process.env.GCP_PROJECT_ID,
  // Uses Application Default Credentials or Workload Identity
});

const messageBus = getPubSubMessageBus({
  pubsub,
  topicPrefix: 'prod-myapp',
  subscriptionOptions: {
    ackDeadlineSeconds: 120,
    retryPolicy: {
      minimumBackoff: { seconds: 5 },
      maximumBackoff: { seconds: 300 },
    },
  },
});
```

## Testing

### Testing Utilities

```typescript
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';

describe('My Tests', () => {
  let pubsub: PubSub;
  let messageBus: ReturnType<typeof getPubSubMessageBus>;

  beforeAll(() => {
    pubsub = new PubSub({ projectId: 'test-project' });
  });

  beforeEach(() => {
    messageBus = getPubSubMessageBus({
      pubsub,
      useEmulator: true,
      topicPrefix: `test-${Date.now()}`,
      cleanupOnClose: true,
      closePubSubClient: false,
    });
  });

  afterEach(async () => {
    await messageBus.close();
  });

  afterAll(async () => {
    await pubsub.close();
  });

  it('should handle commands', async () => {
    const received: unknown[] = [];

    messageBus.handle(async (cmd) => {
      received.push(cmd);
    }, 'TestCommand');

    await messageBus.start();

    await messageBus.send({
      type: 'TestCommand',
      data: { value: 42 },
    });

    // Wait for async delivery
    await new Promise((r) => setTimeout(r, 500));

    expect(received).toHaveLength(1);
  });
});
```

### Running Tests

```bash
# Start PubSub emulator
gcloud beta emulators pubsub start --project=test-project

# Or use Docker
docker run -p 8085:8085 gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
  gcloud beta emulators pubsub start --host-port=0.0.0.0:8085

# Set environment variable
export PUBSUB_EMULATOR_HOST=localhost:8085

# Run tests
npm test
```

## Examples

### Complete Shopping Cart Example

See [examples/shopping-cart](./examples/shopping-cart) for a full application including:

- Event-sourced shopping cart with Firestore
- Express.js API with OpenAPI spec
- Docker Compose setup with all emulators
- Unit, integration, and E2E tests

```bash
cd examples/shopping-cart
docker-compose up

# API: http://localhost:3000
# Firebase UI: http://localhost:4000
# PubSub UI: http://localhost:4001
```

### Multiple Event Subscribers

```typescript
// Analytics service
messageBus.subscribe(async (event) => {
  await analytics.track(event);
}, 'OrderCreated');

// Notification service
messageBus.subscribe(async (event) => {
  await email.sendConfirmation(event.data.customerId);
}, 'OrderCreated');

// Inventory service
messageBus.subscribe(async (event) => {
  await inventory.reserve(event.data.items);
}, 'OrderCreated');

// All three receive every OrderCreated event
```

### Scheduled Messages

```typescript
// Schedule for future
messageBus.schedule(
  { type: 'SendReminder', data: { userId: '123' } },
  { afterInMs: 24 * 60 * 60 * 1000 }  // 24 hours
);

// Schedule for specific time
messageBus.schedule(
  { type: 'SendReminder', data: { userId: '123' } },
  { at: new Date('2024-12-25T10:00:00Z') }
);
```

See [docs/EXAMPLES.md](./docs/EXAMPLES.md) for more examples.

## Architecture

### Message Format

Messages are wrapped in an envelope for transport:

```typescript
interface PubSubMessageEnvelope {
  type: string;           // Message type name
  kind: 'command' | 'event';
  data: unknown;          // Serialized data
  metadata?: unknown;     // Optional metadata
  timestamp: string;      // ISO 8601
  messageId: string;      // UUID for idempotency
}
```

### Date Serialization

JavaScript `Date` objects are preserved through serialization:

```typescript
// Original
{ createdAt: new Date('2024-01-15T10:00:00Z') }

// Serialized
{ createdAt: { __type: 'Date', value: '2024-01-15T10:00:00.000Z' } }

// Deserialized (restored as Date object)
{ createdAt: Date('2024-01-15T10:00:00Z') }
```

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Handler succeeds | Message acknowledged |
| Transient error | Message nack'd, retried with backoff |
| Permanent error | Message ack'd, logged |
| No handler | Message nack'd for retry |

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for design decisions.

## Compatibility

- **Node.js**: >= 18.0.0
- **Emmett**: ^0.39.0
- **@google-cloud/pubsub**: ^4.8.0

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests (requires emulator)
npm run test:int

# Lint
npm run lint

# Format
npm run format
```

## License

MIT

## Resources

- [Emmett Documentation](https://event-driven-io.github.io/emmett/)
- [Google Cloud Pub/Sub Docs](https://cloud.google.com/pubsub/docs)
- [GitHub Repository](https://github.com/emmett-community/emmett-google-pubsub)

## Support

- **Issues**: [GitHub Issues](https://github.com/emmett-community/emmett-google-pubsub/issues)
- **Discussions**: [GitHub Discussions](https://github.com/emmett-community/emmett-google-pubsub/discussions)
- **Emmett Discord**: [Join Discord](https://discord.gg/fTpqUTMmVa)

## Acknowledgments

- Built for the [Emmett](https://event-driven-io.github.io/emmett/) framework by [Oskar Dudycz](https://github.com/oskardudycz)
- Part of the [Emmett Community](https://github.com/emmett-community)
