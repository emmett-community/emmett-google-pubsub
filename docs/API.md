# API Reference

Complete API documentation for `@emmett-community/emmett-google-pubsub`.

## Table of Contents

- [getPubSubMessageBus](#getpubsubmessagebus)
- [Configuration Types](#configuration-types)
  - [PubSubMessageBusConfig](#pubsubmessagebusconfig)
  - [SubscriptionOptions](#subscriptionoptions)
- [Message Bus Methods](#message-bus-methods)
  - [send](#send)
  - [publish](#publish)
  - [handle](#handle)
  - [subscribe](#subscribe)
  - [schedule](#schedule)
  - [dequeue](#dequeue)
- [Lifecycle Methods](#lifecycle-methods)
  - [start](#start)
  - [close](#close)
  - [isStarted](#isstarted)
- [Types](#types)
  - [PubSubMessageEnvelope](#pubsubmessageenvelope)
  - [PubSubMessageBusLifecycle](#pubsubmessagebuslifecycle)
- [Testing Utilities](#testing-utilities)

---

## getPubSubMessageBus

Creates a Google Cloud Pub/Sub message bus instance.

```typescript
function getPubSubMessageBus(
  config: PubSubMessageBusConfig
): MessageBus & EventSubscription & CommandProcessor & ScheduledMessageProcessor & PubSubMessageBusLifecycle
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `PubSubMessageBusConfig` | Configuration options |

**Returns:** Message bus instance implementing all Emmett interfaces plus lifecycle methods.

**Example:**

```typescript
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';

const pubsub = new PubSub({ projectId: 'my-project' });

const messageBus = getPubSubMessageBus({
  pubsub,
  topicPrefix: 'myapp',
  useEmulator: process.env.NODE_ENV !== 'production',
});
```

---

## Configuration Types

### PubSubMessageBusConfig

Main configuration object for the message bus.

```typescript
interface PubSubMessageBusConfig {
  pubsub: PubSub;
  instanceId?: string;
  topicPrefix?: string;
  useEmulator?: boolean;
  subscriptionOptions?: SubscriptionOptions;
  autoCreateResources?: boolean;
  cleanupOnClose?: boolean;
  closePubSubClient?: boolean;
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `pubsub` | `PubSub` | **required** | Google Cloud PubSub client instance |
| `instanceId` | `string` | auto-generated UUID | Unique identifier for this instance's subscriptions |
| `topicPrefix` | `string` | `"emmett"` | Prefix for topic/subscription names |
| `useEmulator` | `boolean` | `false` | Enable emulator mode (disables Cloud Scheduler) |
| `subscriptionOptions` | `SubscriptionOptions` | see below | Subscription configuration |
| `autoCreateResources` | `boolean` | `true` | Auto-create topics and subscriptions |
| `cleanupOnClose` | `boolean` | `false` | Delete subscriptions on close |
| `closePubSubClient` | `boolean` | `true` | Close PubSub client on close |

### SubscriptionOptions

Configuration for PubSub subscriptions.

```typescript
interface SubscriptionOptions {
  ackDeadlineSeconds?: number;
  retryPolicy?: {
    minimumBackoff?: { seconds: number };
    maximumBackoff?: { seconds: number };
  };
  deadLetterPolicy?: {
    deadLetterTopic?: string;
    maxDeliveryAttempts?: number;
  };
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `ackDeadlineSeconds` | `number` | `60` | Acknowledgment deadline in seconds |
| `retryPolicy.minimumBackoff` | `{ seconds: number }` | `{ seconds: 10 }` | Minimum retry backoff |
| `retryPolicy.maximumBackoff` | `{ seconds: number }` | `{ seconds: 600 }` | Maximum retry backoff |
| `deadLetterPolicy.deadLetterTopic` | `string` | - | Topic for failed messages |
| `deadLetterPolicy.maxDeliveryAttempts` | `number` | `5` | Max retries before dead letter |

**Example:**

```typescript
const messageBus = getPubSubMessageBus({
  pubsub,
  subscriptionOptions: {
    ackDeadlineSeconds: 120,
    retryPolicy: {
      minimumBackoff: { seconds: 5 },
      maximumBackoff: { seconds: 300 },
    },
    deadLetterPolicy: {
      deadLetterTopic: 'projects/my-project/topics/dead-letters',
      maxDeliveryAttempts: 10,
    },
  },
});
```

---

## Message Bus Methods

### send

Sends a command to be processed by a single handler.

```typescript
send<CommandType extends Command>(command: CommandType): Promise<void>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `command` | `Command` | Command object with `type` and `data` |

**Behavior:**

- Commands are processed by exactly one handler (1-to-1)
- If no handler is registered, the message is nack'd for retry
- Can be called before `start()` (producer-only mode)

**Example:**

```typescript
await messageBus.send({
  type: 'AddProductItem',
  data: {
    productId: 'product-123',
    quantity: 2,
  },
});
```

### publish

Publishes an event to all subscribers.

```typescript
publish<EventType extends Event>(event: EventType): Promise<void>
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `event` | `Event` | Event object with `type` and `data` |

**Behavior:**

- Events are delivered to all subscribers (1-to-many)
- Each subscriber has its own PubSub subscription
- Can be called before `start()` (producer-only mode)

**Example:**

```typescript
await messageBus.publish({
  type: 'ProductItemAdded',
  data: {
    productId: 'product-123',
    quantity: 2,
    addedAt: new Date(),
  },
});
```

### handle

Registers a command handler.

```typescript
handle<CommandType extends Command>(
  handler: SingleMessageHandler<CommandType>,
  ...commandTypeNames: CommandType['type'][]
): void
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `handler` | `SingleMessageHandler` | Async function to process commands |
| `commandTypeNames` | `string[]` | Command type names to handle |

**Behavior:**

- Only one handler per command type is allowed
- Throws `EmmettError` if duplicate handler registered
- Must be called before `start()`

**Example:**

```typescript
messageBus.handle(
  async (command) => {
    console.log('Processing:', command.type, command.data);
    // Handle the command
  },
  'AddProductItem',
  'RemoveProductItem'
);
```

### subscribe

Subscribes to events.

```typescript
subscribe<EventType extends Event>(
  handler: SingleMessageHandler<EventType>,
  ...eventTypeNames: EventType['type'][]
): void
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `handler` | `SingleMessageHandler` | Async function to process events |
| `eventTypeNames` | `string[]` | Event type names to subscribe to |

**Behavior:**

- Multiple subscribers per event type allowed
- Each subscriber gets its own PubSub subscription
- Must be called before `start()`

**Example:**

```typescript
// First subscriber
messageBus.subscribe(
  async (event) => {
    console.log('Analytics:', event.type);
  },
  'ProductItemAdded'
);

// Second subscriber (same event)
messageBus.subscribe(
  async (event) => {
    console.log('Notification:', event.type);
  },
  'ProductItemAdded'
);
```

### schedule

Schedules a message for future delivery.

```typescript
schedule<MessageType extends Message>(
  message: MessageType,
  options?: { afterInMs: number } | { at: Date }
): void
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `message` | `Message` | Command or event to schedule |
| `options` | `object` | Timing options |
| `options.afterInMs` | `number` | Delay in milliseconds |
| `options.at` | `Date` | Specific delivery time |

**Behavior:**

- **Production mode**: Uses PubSub's native scheduling
- **Emulator mode**: Stores in-memory, use `dequeue()` to retrieve

**Example:**

```typescript
// Schedule for 5 minutes from now
messageBus.schedule(
  { type: 'SendReminder', data: { userId: '123' } },
  { afterInMs: 5 * 60 * 1000 }
);

// Schedule for specific time
messageBus.schedule(
  { type: 'SendReminder', data: { userId: '123' } },
  { at: new Date('2024-12-25T00:00:00Z') }
);
```

### dequeue

Retrieves scheduled messages ready for delivery (emulator mode only).

```typescript
dequeue(): ScheduledMessage[]
```

**Returns:** Array of messages whose scheduled time has passed.

**Behavior:**

- Only works in emulator mode
- Returns empty array in production mode
- Removes messages from internal queue

**Example:**

```typescript
// In test or emulator mode
const readyMessages = messageBus.dequeue();
for (const msg of readyMessages) {
  console.log('Ready for delivery:', msg.type);
}
```

---

## Lifecycle Methods

### start

Starts the message bus and begins listening for messages.

```typescript
start(): Promise<void>
```

**Behavior:**

1. Creates all required topics
2. Creates subscriptions for registered handlers
3. Starts listening on all subscriptions
4. Begins message routing

**Important:**

- Call after registering all handlers
- Required for receiving messages (not for sending)
- Throws if already started

**Example:**

```typescript
// Register handlers first
messageBus.handle(myHandler, 'MyCommand');
messageBus.subscribe(mySubscriber, 'MyEvent');

// Then start
await messageBus.start();
console.log('Message bus is now listening');
```

### close

Gracefully shuts down the message bus.

```typescript
close(): Promise<void>
```

**Behavior:**

1. Stops accepting new messages
2. Waits for in-flight messages to complete
3. Removes subscription listeners
4. Optionally deletes subscriptions (`cleanupOnClose: true`)
5. Optionally closes PubSub client (`closePubSubClient: true`)

**Example:**

```typescript
// Graceful shutdown
process.on('SIGTERM', async () => {
  await messageBus.close();
  process.exit(0);
});
```

### isStarted

Checks if the message bus is currently running.

```typescript
isStarted(): boolean
```

**Returns:** `true` if started and not closed.

**Example:**

```typescript
if (!messageBus.isStarted()) {
  await messageBus.start();
}
```

---

## Types

### PubSubMessageEnvelope

Internal message format used for PubSub transport.

```typescript
interface PubSubMessageEnvelope {
  type: string;
  kind: 'command' | 'event';
  data: unknown;
  metadata?: unknown;
  timestamp: string;
  messageId: string;
}
```

| Property | Type | Description |
|----------|------|-------------|
| `type` | `string` | Message type name |
| `kind` | `'command' \| 'event'` | Message classification |
| `data` | `unknown` | Serialized message data |
| `metadata` | `unknown` | Optional metadata |
| `timestamp` | `string` | ISO 8601 timestamp |
| `messageId` | `string` | UUID for idempotency |

### PubSubMessageBusLifecycle

Lifecycle interface for the message bus.

```typescript
interface PubSubMessageBusLifecycle {
  start(): Promise<void>;
  close(): Promise<void>;
  isStarted(): boolean;
}
```

---

## Testing Utilities

The package exports testing utilities from the `/testing` subpath:

```typescript
import { /* utilities */ } from '@emmett-community/emmett-google-pubsub/testing';
```

### Available Utilities

| Utility | Description |
|---------|-------------|
| `getTestPubSub()` | Creates PubSub client configured for emulator |
| `createTestMessageBus()` | Creates message bus with test defaults |
| `waitForMessages()` | Waits for async message delivery |

### Example Test Setup

```typescript
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';

describe('My Tests', () => {
  let messageBus: ReturnType<typeof getPubSubMessageBus>;
  let pubsub: PubSub;

  beforeAll(() => {
    pubsub = new PubSub({
      projectId: 'test-project',
    });
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

  it('should send and receive commands', async () => {
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

---

## Error Handling

### EmmettError

Base error class for message bus errors.

```typescript
import { EmmettError } from '@event-driven-io/emmett';

try {
  messageBus.handle(handler, 'MyCommand');
  messageBus.handle(anotherHandler, 'MyCommand'); // Throws!
} catch (error) {
  if (error instanceof EmmettError) {
    console.error('Duplicate handler:', error.message);
  }
}
```

### Message Processing Errors

| Scenario | Behavior |
|----------|----------|
| Handler succeeds | Message acknowledged |
| Handler throws (transient) | Message nack'd, retried with backoff |
| Handler throws (permanent) | Message ack'd, logged as error |
| No handler registered | Message nack'd for retry |

---

## See Also

- [Architecture](./ARCHITECTURE.md) - Design decisions and patterns
- [Examples](./EXAMPLES.md) - Usage scenarios and patterns
- [README](../README.md) - Quick start guide
