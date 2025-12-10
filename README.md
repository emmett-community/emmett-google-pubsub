# @emmett-community/emmett-google-pubsub

Google Cloud Pub/Sub message bus implementation for [Emmett](https://event-driven-io.github.io/emmett/), the Node.js event sourcing framework.

[![npm version](https://img.shields.io/npm/v/@emmett-community/emmett-google-pubsub.svg)](https://www.npmjs.com/package/@emmett-community/emmett-google-pubsub)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- ✅ **Distributed Message Bus** - Scale command/event handling across multiple instances
- ✅ **Type-Safe** - Full TypeScript support with comprehensive types
- ✅ **Automatic Topic Management** - Auto-creates topics and subscriptions
- ✅ **Message Scheduling** - Schedule commands/events for future execution
- ✅ **Error Handling** - Built-in retry logic and dead letter queue support
- ✅ **Emulator Support** - Local development with PubSub emulator
- ✅ **Testing Utilities** - Helper functions for easy testing
- ✅ **Emmett Compatible** - Drop-in replacement for in-memory message bus

## Installation

```bash
npm install @emmett-community/emmett-google-pubsub @google-cloud/pubsub
```

## Quick Start

```typescript
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';

// Initialize PubSub client
const pubsub = new PubSub({
  projectId: 'your-project-id',
});

// Create message bus
const messageBus = getPubSubMessageBus({
  pubsub,
});

// Register command handler
messageBus.handle(async (command) => {
  // Handle command
}, 'AddProductItem');

// Subscribe to events
messageBus.subscribe(async (event) => {
  // Handle event
}, 'ProductItemAdded');

// Start listening
await messageBus.start();

// Send commands
await messageBus.send({
  type: 'AddProductItem',
  data: { productId: '123', quantity: 2 },
});

// Publish events
await messageBus.publish({
  type: 'ProductItemAdded',
  data: { productId: '123', quantity: 2 },
});
```

## Documentation

> **Note:** This package is currently under development. Full documentation will be available upon completion.

## Development Status

**Phase 1: Core Infrastructure** - ✅ Complete

- Package setup and configuration
- Type definitions
- Serialization layer with Date handling
- Topic/subscription management
- Utility functions

**Phase 2: Message Bus Implementation** - ✅ Complete

- Message handler with command/event routing
- Dual-mode scheduler (production/emulator)
- Full MessageBus implementation
- Lifecycle management (start/close)
- All Emmett interfaces implemented

**Phase 3: Testing** - ✅ Complete

- 91 unit tests (95%+ coverage)
- 46 integration tests (100% passing)
- Commands, events, scheduling tests
- Full workflow and lifecycle tests
- Performance and stress tests
- **Total: 137/137 tests passing** ✅

**Phase 4: Shopping Cart Example** - ✅ Complete

- Adapted shopping cart example from emmett-google-realtime-db
- Replaced in-memory message bus with PubSub message bus
- Added PubSub emulator and UI to docker-compose
- Updated tests with timing adjustments for async message delivery
- All business logic remains unchanged (drop-in replacement demonstrated)

**Phase 5: Documentation** - ⏳ Pending

## License

MIT © Emmett Community

## Resources

- [Emmett Documentation](https://event-driven-io.github.io/emmett/)
- [Google Cloud Pub/Sub Docs](https://cloud.google.com/pubsub/docs)
- [GitHub Repository](https://github.com/emmett-community/emmett-google-pubsub)
