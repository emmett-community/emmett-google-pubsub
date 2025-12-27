import { EventEmitter } from 'node:events';

type PublishRequest = {
  data: Buffer;
  attributes?: Record<string, string>;
};

class InMemoryMessage {
  readonly data: Buffer;
  readonly attributes?: Record<string, string>;
  readonly deliveryAttempt: number;
  private handled = false;

  constructor(
    private readonly subscription: InMemorySubscription,
    request: PublishRequest,
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
    this.subscription.retry(this.data, this.attributes, this.deliveryAttempt + 1);
  }
}

class InMemorySubscription extends EventEmitter {
  private created = false;
  private closed = false;

  constructor(
    private readonly topic: InMemoryTopic,
    public readonly name: string,
  ) {
    super();
  }

  async exists(): Promise<[boolean]> {
    return [this.created];
  }

  async create(_config?: unknown): Promise<[InMemorySubscription]> {
    this.created = true;
    this.topic.registerSubscription(this);
    return [this];
  }

  async delete(): Promise<[void]> {
    this.created = false;
    this.closed = true;
    this.topic.unregisterSubscription(this.name);
    this.removeAllListeners();
    return [undefined];
  }

  async close(): Promise<void> {
    this.closed = true;
    this.removeAllListeners();
  }

  deliver(request: PublishRequest, deliveryAttempt = 1): void {
    if (!this.created || this.closed) {
      return;
    }
    const message = new InMemoryMessage(this, request, deliveryAttempt);
    queueMicrotask(() => this.emit('message', message));
  }

  retry(
    _data: Buffer,
    _attributes: Record<string, string> | undefined,
    _deliveryAttempt: number,
  ): void {
    if (this.closed || !this.created) {
      return;
    }

    // No retry scheduling for in-memory tests to keep behavior deterministic.
  }
}

class InMemoryTopic {
  private created = false;
  private readonly subscriptions = new Map<string, InMemorySubscription>();

  constructor(public readonly name: string) {}

  async exists(): Promise<[boolean]> {
    return [this.created];
  }

  async create(): Promise<[InMemoryTopic]> {
    this.created = true;
    return [this];
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

  async publishMessage(request: PublishRequest): Promise<string> {
    for (const subscription of this.subscriptions.values()) {
      subscription.deliver(request);
    }
    return `in-memory-${Date.now()}`;
  }
}

export class InMemoryPubSub {
  private readonly topics = new Map<string, InMemoryTopic>();

  topic(name: string): InMemoryTopic {
    let topic = this.topics.get(name);
    if (!topic) {
      topic = new InMemoryTopic(name);
      this.topics.set(name, topic);
    }
    return topic;
  }

  async close(): Promise<void> {
    return;
  }
}
