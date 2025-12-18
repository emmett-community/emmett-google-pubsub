# Examples

Practical examples and usage patterns for `@emmett-community/emmett-google-pubsub`.

## Table of Contents

- [Basic Command/Event Flow](#basic-commandevent-flow)
- [Shopping Cart Example](#shopping-cart-example)
- [Producer-Only Mode](#producer-only-mode)
- [Multiple Subscribers](#multiple-subscribers)
- [Error Handling Patterns](#error-handling-patterns)
- [Testing Patterns](#testing-patterns)
- [Production Deployment](#production-deployment)

---

## Basic Command/Event Flow

A minimal example showing command sending and event publishing.

```typescript
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';
import type { Command, Event } from '@event-driven-io/emmett';

// Define message types
type CreateOrder = Command<'CreateOrder', {
  orderId: string;
  customerId: string;
  items: { productId: string; quantity: number }[];
}>;

type OrderCreated = Event<'OrderCreated', {
  orderId: string;
  customerId: string;
  totalAmount: number;
  createdAt: Date;
}>;

// Initialize
const pubsub = new PubSub({ projectId: 'my-project' });
const messageBus = getPubSubMessageBus({
  pubsub,
  topicPrefix: 'orders',
});

// Register command handler
messageBus.handle<CreateOrder>(
  async (command) => {
    console.log('Creating order:', command.data.orderId);

    // Process the order...
    const totalAmount = command.data.items.reduce(
      (sum, item) => sum + item.quantity * 10, // simplified pricing
      0
    );

    // Publish event
    await messageBus.publish<OrderCreated>({
      type: 'OrderCreated',
      data: {
        orderId: command.data.orderId,
        customerId: command.data.customerId,
        totalAmount,
        createdAt: new Date(),
      },
    });
  },
  'CreateOrder'
);

// Subscribe to events
messageBus.subscribe<OrderCreated>(
  async (event) => {
    console.log('Order created:', event.data.orderId);
    console.log('Total:', event.data.totalAmount);
    // Send confirmation email, update analytics, etc.
  },
  'OrderCreated'
);

// Start the message bus
await messageBus.start();

// Send a command
await messageBus.send<CreateOrder>({
  type: 'CreateOrder',
  data: {
    orderId: 'order-123',
    customerId: 'customer-456',
    items: [
      { productId: 'product-1', quantity: 2 },
      { productId: 'product-2', quantity: 1 },
    ],
  },
});
```

---

## Shopping Cart Example

The package includes a complete shopping cart example demonstrating integration with Emmett's event sourcing.

### Project Structure

```
examples/shopping-cart/
├── src/
│   ├── index.ts              # Application entry point
│   ├── handlers/
│   │   └── shoppingCarts.ts  # HTTP handlers
│   └── shoppingCarts/
│       ├── shoppingCart.ts   # Domain model
│       ├── businessLogic.ts  # Commands and decisions
│       └── getDetails/       # Read model projection
├── docker-compose.yml        # Firebase + PubSub emulators
└── openapi.yml              # API specification
```

### Running the Example

```bash
cd examples/shopping-cart

# Start all services (Firebase, PubSub, app)
docker-compose up

# API available at http://localhost:3000
# Firebase UI at http://localhost:4000
# PubSub UI at http://localhost:4001
```

### Key Integration Points

**1. Message Bus Initialization (`src/index.ts`):**

```typescript
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';

const pubsub = new PubSub({
  projectId: PUBSUB_PROJECT_ID,
});

const messageBus = getPubSubMessageBus({
  pubsub,
  useEmulator: !!PUBSUB_EMULATOR_HOST,
  topicPrefix: 'shopping-cart',
});

// Observer subscription for PubSub UI visualization
if (PUBSUB_EMULATOR_HOST) {
  messageBus.subscribe(
    async () => { /* noop */ },
    'ShoppingCartConfirmed',
  );
}

await messageBus.start();
```

**2. Publishing Events from Handlers:**

```typescript
// In handlers/shoppingCarts.ts
export const confirmShoppingCart = on(async (request) => {
  const result = await handle(
    eventStore,
    shoppingCartId,
    (state) => confirm({ ...state, ...shoppingCartCommand }),
  );

  // Publish event via message bus
  if (result.newEvents.length > 0) {
    for (const event of result.newEvents) {
      await messageBus.publish(event);
    }
  }

  return NoContent();
});
```

**3. Graceful Shutdown:**

```typescript
const gracefulShutdown = async (signal: string) => {
  console.log(`${signal} received. Shutting down...`);
  await messageBus.close();
  await firestore.terminate();
  process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
```

---

## Producer-Only Mode

Use the message bus to publish messages without consuming them.

```typescript
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';

// API Gateway - only produces messages
const pubsub = new PubSub({ projectId: 'my-project' });
const messageBus = getPubSubMessageBus({ pubsub });

// No handlers registered
// No start() called
// Can still send/publish

export async function handleApiRequest(req, res) {
  // Validate request...

  // Send command to be processed by another service
  await messageBus.send({
    type: 'ProcessPayment',
    data: {
      orderId: req.body.orderId,
      amount: req.body.amount,
    },
  });

  res.json({ status: 'accepted' });
}
```

**Benefits:**

- No subscription overhead
- Lightweight API services
- Clear separation of concerns

---

## Multiple Subscribers

Multiple handlers can subscribe to the same event type.

```typescript
const messageBus = getPubSubMessageBus({ pubsub });

// Analytics subscriber
messageBus.subscribe(
  async (event) => {
    await analyticsService.trackOrder(event.data);
    console.log('Analytics updated for order:', event.data.orderId);
  },
  'OrderCreated'
);

// Notification subscriber
messageBus.subscribe(
  async (event) => {
    await emailService.sendConfirmation(event.data.customerId);
    console.log('Email sent for order:', event.data.orderId);
  },
  'OrderCreated'
);

// Inventory subscriber
messageBus.subscribe(
  async (event) => {
    await inventoryService.reserveItems(event.data.items);
    console.log('Inventory reserved for order:', event.data.orderId);
  },
  'OrderCreated'
);

await messageBus.start();

// Publishing one event triggers all three subscribers
await messageBus.publish({
  type: 'OrderCreated',
  data: { orderId: '123', customerId: '456', items: [...] },
});
```

**Each subscriber:**

- Has its own PubSub subscription
- Receives all events independently
- Processes at its own pace
- Can fail independently without affecting others

---

## Error Handling Patterns

### Basic Error Handling

```typescript
messageBus.handle(
  async (command) => {
    try {
      await processCommand(command);
    } catch (error) {
      if (error instanceof ValidationError) {
        // Permanent error - don't retry
        console.error('Validation failed:', error.message);
        // Message will be ack'd (not retried)
        throw error;
      }

      if (error instanceof NetworkError) {
        // Transient error - will retry
        console.warn('Network error, will retry:', error.message);
        throw error;
      }

      // Unknown error
      throw error;
    }
  },
  'ProcessOrder'
);
```

### Dead Letter Queue Setup

```typescript
const messageBus = getPubSubMessageBus({
  pubsub,
  subscriptionOptions: {
    deadLetterPolicy: {
      deadLetterTopic: 'projects/my-project/topics/dead-letters',
      maxDeliveryAttempts: 5,
    },
  },
});

// Separately, handle dead letters
const deadLetterBus = getPubSubMessageBus({
  pubsub,
  topicPrefix: 'dead-letters',
});

deadLetterBus.handle(
  async (message) => {
    console.error('Message failed permanently:', message);
    await alertService.notify('Message processing failed', message);
    // Store for manual review
    await deadLetterStore.save(message);
  },
  'ProcessOrder' // Same type as original
);
```

### Idempotent Handlers

```typescript
const processedIds = new Set<string>();

messageBus.handle(
  async (command) => {
    // Check if already processed (using messageId from envelope)
    const messageId = command.metadata?.messageId;
    if (processedIds.has(messageId)) {
      console.log('Duplicate message, skipping:', messageId);
      return;
    }

    await processCommand(command);
    processedIds.add(messageId);
  },
  'ProcessOrder'
);
```

---

## Testing Patterns

### Unit Testing Handlers

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Order Handler', () => {
  it('should create order and publish event', async () => {
    const publishMock = vi.fn();
    const messageBus = {
      publish: publishMock,
    };

    await handleCreateOrder(
      { type: 'CreateOrder', data: { orderId: '123' } },
      messageBus
    );

    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'OrderCreated',
        data: expect.objectContaining({ orderId: '123' }),
      })
    );
  });
});
```

### Integration Testing with Emulator

```typescript
import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';

describe('Message Bus Integration', () => {
  let pubsub: PubSub;
  let messageBus: ReturnType<typeof getPubSubMessageBus>;

  beforeAll(() => {
    // Requires PUBSUB_EMULATOR_HOST=localhost:8085
    pubsub = new PubSub({ projectId: 'test-project' });
  });

  beforeEach(() => {
    // Unique prefix per test to avoid conflicts
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

  it('should deliver commands to handler', async () => {
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
    expect(received[0].data.value).toBe(42);
  });

  it('should deliver events to all subscribers', async () => {
    const subscriber1: unknown[] = [];
    const subscriber2: unknown[] = [];

    messageBus.subscribe(async (evt) => {
      subscriber1.push(evt);
    }, 'TestEvent');

    messageBus.subscribe(async (evt) => {
      subscriber2.push(evt);
    }, 'TestEvent');

    await messageBus.start();

    await messageBus.publish({
      type: 'TestEvent',
      data: { message: 'hello' },
    });

    await new Promise((r) => setTimeout(r, 500));

    expect(subscriber1).toHaveLength(1);
    expect(subscriber2).toHaveLength(1);
  });
});
```

### Testing Scheduled Messages

```typescript
describe('Scheduling', () => {
  it('should schedule and dequeue messages', async () => {
    const messageBus = getPubSubMessageBus({
      pubsub,
      useEmulator: true,
      topicPrefix: 'test-schedule',
    });

    // Schedule for past (immediate)
    messageBus.schedule(
      { type: 'Reminder', data: { userId: '123' } },
      { afterInMs: -1000 } // 1 second in the past
    );

    // Schedule for future
    messageBus.schedule(
      { type: 'Reminder', data: { userId: '456' } },
      { afterInMs: 60000 } // 1 minute in future
    );

    const ready = messageBus.dequeue();

    expect(ready).toHaveLength(1);
    expect(ready[0].data.userId).toBe('123');

    await messageBus.close();
  });
});
```

---

## Production Deployment

### Environment Configuration

```typescript
// config.ts
export const config = {
  pubsub: {
    projectId: process.env.GCP_PROJECT_ID!,
    // For Workload Identity (GKE)
    // No credentials needed - uses service account
  },
  messageBus: {
    topicPrefix: process.env.TOPIC_PREFIX || 'myapp',
    useEmulator: process.env.PUBSUB_EMULATOR_HOST !== undefined,
  },
};
```

### Service Account Permissions

Required IAM roles for the service account:

- `roles/pubsub.publisher` - Publish messages
- `roles/pubsub.subscriber` - Receive messages
- `roles/pubsub.editor` - Create topics/subscriptions (if `autoCreateResources: true`)

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  replicas: 3
  template:
    spec:
      serviceAccountName: order-service-sa
      containers:
        - name: app
          image: gcr.io/my-project/order-service:latest
          env:
            - name: GCP_PROJECT_ID
              value: my-production-project
            - name: TOPIC_PREFIX
              value: prod-orders
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          livenessProbe:
            httpGet:
              path: /health
              port: 8080
          readinessProbe:
            httpGet:
              path: /ready
              port: 8080
```

### Health Checks

```typescript
import express from 'express';

const app = express();

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.get('/ready', (req, res) => {
  if (messageBus.isStarted()) {
    res.json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not ready' });
  }
});
```

### Graceful Shutdown

```typescript
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`${signal} received. Starting graceful shutdown...`);

  // Stop accepting new requests
  server.close();

  // Wait for in-flight requests (max 30s)
  await new Promise((r) => setTimeout(r, 5000));

  // Close message bus
  await messageBus.close();
  console.log('Message bus closed');

  process.exit(0);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

---

## See Also

- [API Reference](./API.md) - Complete API documentation
- [Architecture](./ARCHITECTURE.md) - Design decisions
- [README](../README.md) - Quick start guide
