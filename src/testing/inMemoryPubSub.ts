import { EventEmitter } from 'node:events';

type PublishRequest = {
  data: Buffer;
  attributes?: Record<string, string>;
};

type DeadLetterPolicy = {
  deadLetterTopic?: string;
  maxDeliveryAttempts?: number;
};

const DEFAULT_MAX_DELIVERY_ATTEMPTS = 5;

class InMemoryMessage {
  readonly data: Buffer;
  readonly attributes?: Record<string, string>;
  readonly deliveryAttempt: number;
  private handled = false;

  constructor(
    private readonly subscription: InMemorySubscription,
    private readonly request: PublishRequest,
    deliveryAttempt = 1,
  ) {
    this.data = request.data;
    this.attributes = request.attributes;
    this.deliveryAttempt = deliveryAttempt;
  }

  ack(): void {
    this.handled = true;
  }

  nack(): void {
    if (this.handled) {
      return;
    }
    this.handled = true;
    this.subscription.retry(this.request, this.deliveryAttempt + 1);
  }
}

class InMemorySubscription extends EventEmitter {
  private created = false;
  private closed = false;
  private deadLetterPolicy?: DeadLetterPolicy;
  private nextListener = 0;

  constructor(
    private readonly topic: InMemoryTopic,
    public readonly name: string,
  ) {
    super();
  }

  exists(): Promise<[boolean]> {
    return Promise.resolve([this.created]);
  }

  create(config?: {
    deadLetterPolicy?: DeadLetterPolicy;
  }): Promise<[InMemorySubscription]> {
    this.created = true;
    this.closed = false;
    this.deadLetterPolicy = config?.deadLetterPolicy;
    this.topic.registerSubscription(this);
    return Promise.resolve([this]);
  }

  delete(): Promise<[void]> {
    this.created = false;
    this.closed = true;
    this.topic.unregisterSubscription(this.name);
    this.removeAllListeners();
    return Promise.resolve([undefined]);
  }

  close(): Promise<void> {
    this.closed = true;
    this.removeAllListeners();
    return Promise.resolve();
  }

  /**
   * Delivers to a single listener, round-robin. Several consumers attached to the same
   * subscription compete for messages, as replicas of a service do on Pub/Sub.
   */
  deliver(request: PublishRequest, deliveryAttempt = 1): void {
    if (!this.created || this.closed) {
      return;
    }
    const message = new InMemoryMessage(this, request, deliveryAttempt);
    queueMicrotask(() => {
      const listeners = this.listeners('message') as Array<
        (message: InMemoryMessage) => void
      >;
      if (listeners.length === 0) {
        return;
      }
      listeners[this.nextListener++ % listeners.length](message);
    });
  }

  /**
   * Redelivery after a nack. Only happens when the subscription has a dead letter policy:
   * the message is redelivered until `maxDeliveryAttempts` and then published to the dead
   * letter topic. Without a policy nothing is redelivered, to keep tests deterministic.
   */
  retry(request: PublishRequest, nextDeliveryAttempt: number): void {
    if (this.closed || !this.created || !this.deadLetterPolicy) {
      return;
    }

    const {
      deadLetterTopic,
      maxDeliveryAttempts = DEFAULT_MAX_DELIVERY_ATTEMPTS,
    } = this.deadLetterPolicy;

    if (nextDeliveryAttempt > maxDeliveryAttempts) {
      if (deadLetterTopic) {
        void this.topic.pubsub.topic(deadLetterTopic).publishMessage(request);
      }
      return;
    }

    this.deliver(request, nextDeliveryAttempt);
  }
}

const notFound = (name: string) =>
  Object.assign(
    new Error(`5 NOT_FOUND: Resource not found (resource=${name}).`),
    {
      code: 5,
    },
  );

class InMemoryTopic {
  private created = false;
  private deleted = false;
  private readonly subscriptions = new Map<string, InMemorySubscription>();

  constructor(
    public readonly name: string,
    readonly pubsub: InMemoryPubSub,
  ) {}

  exists(): Promise<[boolean]> {
    return Promise.resolve([this.created]);
  }

  getMetadata(): Promise<[{ name: string }]> {
    return this.created
      ? Promise.resolve([{ name: this.name }])
      : Promise.reject(notFound(this.name));
  }

  create(): Promise<[InMemoryTopic]> {
    this.created = true;
    this.deleted = false;
    return Promise.resolve([this]);
  }

  /** Deletes the topic, as an operator could: publishing to it fails with NOT_FOUND until it is created again. */
  delete(): Promise<void> {
    this.created = false;
    this.deleted = true;
    return Promise.resolve();
  }

  subscription(name: string): InMemorySubscription {
    let subscription = this.subscriptions.get(name);
    if (!subscription) {
      subscription = new InMemorySubscription(this, name);
      this.subscriptions.set(name, subscription);
    }
    return subscription;
  }

  registerSubscription(subscription: InMemorySubscription): void {
    this.subscriptions.set(subscription.name, subscription);
  }

  unregisterSubscription(name: string): void {
    this.subscriptions.delete(name);
  }

  publishMessage(request: PublishRequest): Promise<string> {
    if (this.deleted) {
      return Promise.reject(notFound(this.name));
    }
    for (const subscription of this.subscriptions.values()) {
      subscription.deliver(request);
    }
    return Promise.resolve(`in-memory-${Date.now()}`);
  }
}

/**
 * In-memory stand-in for the parts of `PubSub` used by the message bus. Meant for unit and
 * integration tests of services; it is not a complete Pub/Sub implementation. Share one
 * instance between buses to model several services or replicas on the same project.
 */
export class InMemoryPubSub {
  private readonly topics = new Map<string, InMemoryTopic>();

  topic(name: string): InMemoryTopic {
    // Accept fully qualified names (projects/<p>/topics/<t>) as the real client does
    const shortName = name.split('/').pop() as string;
    let topic = this.topics.get(shortName);
    if (!topic) {
      topic = new InMemoryTopic(shortName, this);
      this.topics.set(shortName, topic);
    }
    return topic;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
