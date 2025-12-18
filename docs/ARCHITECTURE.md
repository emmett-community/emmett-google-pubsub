# Architecture

This document describes the design decisions and architecture of `@emmett-community/emmett-google-pubsub`.

## Table of Contents

- [Overview](#overview)
- [Topic and Subscription Strategy](#topic-and-subscription-strategy)
- [Message Format](#message-format)
- [Handler Lifecycle](#handler-lifecycle)
- [Scheduler (Dual Mode)](#scheduler-dual-mode)
- [Error Handling Strategy](#error-handling-strategy)
- [Serialization Design](#serialization-design)
- [Trade-offs and Alternatives](#trade-offs-and-alternatives)

---

## Overview

The package provides a distributed message bus implementation using Google Cloud Pub/Sub that is fully compatible with Emmett's `MessageBus` interface. It enables scaling command and event handling across multiple application instances while maintaining the same programming model as the in-memory message bus.

```
┌─────────────────────────────────────────────────────────────┐
│                     Application                              │
├──────────────────────┬──────────────────────────────────────┤
│   MessageBus API     │        Emmett Interfaces             │
│   - send()           │   - MessageBus                       │
│   - publish()        │   - CommandProcessor                 │
│   - handle()         │   - EventSubscription                │
│   - subscribe()      │   - ScheduledMessageProcessor        │
├──────────────────────┴──────────────────────────────────────┤
│              PubSub Message Bus Implementation               │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│   │ Topic       │  │ Message     │  │ Scheduler       │    │
│   │ Manager     │  │ Handler     │  │ (Dual Mode)     │    │
│   └─────────────┘  └─────────────┘  └─────────────────┘    │
├─────────────────────────────────────────────────────────────┤
│                  Google Cloud Pub/Sub                        │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│   │ Topics      │  │Subscriptions│  │ Cloud Scheduler │    │
│   └─────────────┘  └─────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Topic and Subscription Strategy

### Naming Convention

All topics and subscriptions follow a consistent naming pattern:

```
{prefix}-{kind}-{MessageType}[-{subscriptionId}]
```

| Component | Description | Example |
|-----------|-------------|---------|
| `prefix` | Configurable prefix | `emmett`, `myapp` |
| `kind` | `cmd` or `evt` | `cmd`, `evt` |
| `MessageType` | The message type name | `AddProductItem` |
| `subscriptionId` | Instance or subscriber ID | `abc123` |

**Examples:**

```
# Command topic
emmett-cmd-AddProductItem

# Command subscription (instance-specific)
emmett-cmd-AddProductItem-instance-123

# Event topic
emmett-evt-ProductItemAdded

# Event subscription (subscriber-specific)
emmett-evt-ProductItemAdded-subscriber-456
```

### Commands (1-to-1)

Commands implement the **competing consumers** pattern:

```
┌──────────────┐
│   Producer   │
└──────┬───────┘
       │ send()
       ▼
┌──────────────────────────────┐
│    Topic: cmd-AddProduct     │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Subscription: cmd-AddProduct│
│  (shared by all instances)   │
└──────────────┬───────────────┘
               │ Only ONE receives
       ┌───────┼───────┐
       ▼       ▼       ▼
   ┌──────┐ ┌──────┐ ┌──────┐
   │Inst 1│ │Inst 2│ │Inst 3│
   └──────┘ └──────┘ └──────┘
```

**Key behaviors:**

- One topic per command type
- One subscription per instance ID
- PubSub ensures only one consumer processes each message
- Duplicate handler registration throws `EmmettError`

### Events (1-to-many)

Events implement the **fan-out** pattern:

```
┌──────────────┐
│   Producer   │
└──────┬───────┘
       │ publish()
       ▼
┌──────────────────────────────┐
│    Topic: evt-OrderCreated   │
└──────────────┬───────────────┘
               │
       ┌───────┼───────┐
       ▼       ▼       ▼
┌──────────┐┌──────────┐┌──────────┐
│  Sub A   ││  Sub B   ││  Sub C   │
│(Analytics││(Notific.)││(Inventory│
└────┬─────┘└────┬─────┘└────┬─────┘
     ▼           ▼           ▼
 ┌───────┐  ┌───────┐  ┌───────┐
 │Handler│  │Handler│  │Handler│
 └───────┘  └───────┘  └───────┘
```

**Key behaviors:**

- One topic per event type
- Each subscriber gets its own subscription (unique ID)
- All subscribers receive all events
- Multiple handlers for same event are allowed

---

## Message Format

### PubSubMessageEnvelope

Messages are wrapped in an envelope for transport:

```typescript
interface PubSubMessageEnvelope {
  type: string;           // Message type name
  kind: 'command' | 'event';
  data: unknown;          // Serialized message data
  metadata?: unknown;     // Optional metadata
  timestamp: string;      // ISO 8601
  messageId: string;      // UUID for idempotency
}
```

### Message Classification

The message bus determines if a message is a command or event based on:

1. **Explicit `kind` property** (if present in the message)
2. **Registration context** (send/handle = command, publish/subscribe = event)
3. **Fallback heuristic** (type name contains "Command" = command)

```typescript
// Explicit kind
await messageBus.send({ type: 'DoSomething', kind: 'command', data: {} });

// Inferred from method
await messageBus.send({ type: 'DoSomething', data: {} });  // → command
await messageBus.publish({ type: 'SomethingDone', data: {} });  // → event
```

---

## Handler Lifecycle

### Three Phases

```
┌─────────────────────────────────────────────────────────────┐
│                 1. REGISTRATION PHASE                        │
│                                                              │
│   messageBus.handle(handler, 'CommandA', 'CommandB')        │
│   messageBus.subscribe(handler, 'EventA', 'EventB')         │
│                                                              │
│   • Handlers stored in local Map                            │
│   • No PubSub resources created yet                         │
│   • Can be called multiple times (accumulates)              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    2. STARTUP PHASE                          │
│                                                              │
│   await messageBus.start()                                   │
│                                                              │
│   • Creates all topics (if autoCreateResources: true)       │
│   • Creates all subscriptions                               │
│   • Attaches message listeners                              │
│   • Begins receiving messages                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    3. RUNTIME PHASE                          │
│                                                              │
│   • Messages routed to registered handlers                  │
│   • send()/publish() work without start() (producer-only)  │
│   • Handlers execute asynchronously                         │
│   • Ack/nack based on handler result                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   4. SHUTDOWN PHASE                          │
│                                                              │
│   await messageBus.close()                                   │
│                                                              │
│   • Stops accepting new messages                            │
│   • Waits for in-flight messages                            │
│   • Removes listeners                                       │
│   • Optionally deletes subscriptions                        │
│   • Optionally closes PubSub client                         │
└─────────────────────────────────────────────────────────────┘
```

### Producer-Only Mode

The message bus supports **producer-only mode** where `start()` is not called:

```typescript
const messageBus = getPubSubMessageBus({ pubsub });

// No handlers registered, no start() called
// Can still send/publish messages

await messageBus.send({ type: 'MyCommand', data: {} });
await messageBus.publish({ type: 'MyEvent', data: {} });

// Another service will handle these messages
```

This is useful for:

- API gateways that only produce messages
- Microservices that don't consume from PubSub
- Testing scenarios

---

## Scheduler (Dual Mode)

The scheduler has two modes depending on the environment:

### Production Mode (Cloud Scheduler)

Uses PubSub's native `publishTime` attribute for delayed delivery:

```typescript
// Schedule for future
messageBus.schedule(
  { type: 'SendReminder', data: {} },
  { at: new Date('2024-12-25T10:00:00Z') }
);

// PubSub handles the timing
// Message delivered at specified time
```

**Behavior:**

- Message published immediately with future `publishTime`
- PubSub holds message until scheduled time
- No additional infrastructure needed

### Emulator Mode (In-Memory)

The PubSub emulator doesn't support scheduling, so messages are stored in memory:

```typescript
// In emulator mode
messageBus.schedule(
  { type: 'SendReminder', data: {} },
  { afterInMs: 60000 }
);

// Must manually dequeue
const ready = messageBus.dequeue();
for (const msg of ready) {
  await messageBus.send(msg);
}
```

**Behavior:**

- Messages stored in local array
- `dequeue()` returns messages past their scheduled time
- Application must poll `dequeue()` and process messages

### Mode Selection

```typescript
const messageBus = getPubSubMessageBus({
  pubsub,
  useEmulator: true,  // Enables in-memory scheduling
});
```

The `useEmulator` flag determines:

| Feature | `useEmulator: false` | `useEmulator: true` |
|---------|---------------------|---------------------|
| Scheduling | Cloud Scheduler | In-memory queue |
| `dequeue()` | Returns `[]` | Returns ready messages |
| Auto-delivery | Yes | No (manual) |

---

## Error Handling Strategy

### Acknowledgment Flow

```
┌─────────────────┐
│ Message Received│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Find Handler    │
└────────┬────────┘
         │
    ┌────┴────┐
    │ Found?  │
    └────┬────┘
    No   │   Yes
    │    │    │
    ▼    │    ▼
┌───────┐│┌─────────────┐
│ NACK  │││ Execute     │
│(retry)│││ Handler     │
└───────┘│└──────┬──────┘
         │       │
         │  ┌────┴────┐
         │  │Success? │
         │  └────┬────┘
         │  Yes  │  No
         │   │   │   │
         │   ▼   │   ▼
         │┌─────┐│┌─────────────┐
         ││ ACK │││ Classify    │
         │└─────┘││ Error       │
         │       │└──────┬──────┘
         │       │       │
         │       │ ┌─────┴─────┐
         │       │ │Transient? │
         │       │ └─────┬─────┘
         │       │  Yes  │  No
         │       │   │   │   │
         │       │   ▼   │   ▼
         │       │┌─────┐│┌─────┐
         │       ││NACK │││ ACK │
         │       ││retry│││+log │
         │       │└─────┘│└─────┘
```

### Error Classification

| Error Type | Action | Example |
|------------|--------|---------|
| **Transient** | NACK (retry) | Network timeout, rate limit |
| **Permanent** | ACK + log | Invalid message, business error |
| **No handler** | NACK (retry) | Handler not yet registered |

### Retry Policy

Default retry behavior:

- **Ack deadline**: 60 seconds
- **Minimum backoff**: 10 seconds
- **Maximum backoff**: 600 seconds (10 minutes)
- **Max attempts**: 5 (before dead letter)

Configure via `subscriptionOptions`:

```typescript
const messageBus = getPubSubMessageBus({
  pubsub,
  subscriptionOptions: {
    ackDeadlineSeconds: 120,
    retryPolicy: {
      minimumBackoff: { seconds: 5 },
      maximumBackoff: { seconds: 300 },
    },
  },
});
```

---

## Serialization Design

### Date Handling

JavaScript `Date` objects are serialized with type markers:

```typescript
// Original message
{
  type: 'OrderCreated',
  data: {
    orderId: '123',
    createdAt: new Date('2024-01-15T10:30:00Z')
  }
}

// Serialized (JSON)
{
  "type": "OrderCreated",
  "data": {
    "orderId": "123",
    "createdAt": {
      "__type": "Date",
      "value": "2024-01-15T10:30:00.000Z"
    }
  }
}

// Deserialized (restored)
{
  type: 'OrderCreated',
  data: {
    orderId: '123',
    createdAt: Date('2024-01-15T10:30:00Z')  // Real Date object
  }
}
```

### Why Custom Date Serialization?

1. **JSON limitation**: `JSON.stringify(new Date())` produces a string
2. **Type preservation**: Handlers expect `Date` objects, not strings
3. **Nested support**: Dates anywhere in the object tree are handled
4. **Reversible**: `deserialize(serialize(obj))` equals original

### Implementation

```typescript
// Replacer (serialize)
function dateReplacer(key: string, value: unknown) {
  if (value instanceof Date) {
    return { __type: 'Date', value: value.toISOString() };
  }
  return value;
}

// Reviver (deserialize)
function dateReviver(key: string, value: unknown) {
  if (value?.__type === 'Date') {
    return new Date(value.value);
  }
  return value;
}
```

---

## Trade-offs and Alternatives

### Topic-per-Type vs Single Topic

**Chosen: Topic-per-Type**

| Aspect | Topic-per-Type | Single Topic |
|--------|---------------|--------------|
| Filtering | Native (subscription filter) | Application-level |
| Scalability | Independent scaling | Bottleneck risk |
| Cost | More topics | Fewer topics |
| Complexity | More resources | Simpler setup |

**Rationale:** Topic-per-type aligns with PubSub best practices and enables independent scaling of different message types.

### Instance ID vs Shared Subscription

**Chosen: Configurable Instance ID**

- Default: Auto-generated UUID
- Option: Custom `instanceId` for sticky subscriptions

**Use cases:**

```typescript
// Ephemeral instances (default)
const bus1 = getPubSubMessageBus({ pubsub });
// instanceId: "abc123-..." (random)

// Persistent instance
const bus2 = getPubSubMessageBus({
  pubsub,
  instanceId: 'worker-1',
});
// instanceId: "worker-1" (stable)
```

### Emulator Scheduling

**Chosen: In-Memory Queue**

Alternatives considered:

1. **Redis**: External dependency
2. **Database**: Complex setup
3. **In-memory**: Simple, sufficient for testing

**Rationale:** Scheduling in emulator mode is primarily for testing. An in-memory queue is simple and has no external dependencies.

---

## See Also

- [API Reference](./API.md) - Complete API documentation
- [Examples](./EXAMPLES.md) - Usage scenarios
- [README](../README.md) - Quick start guide
