import type { Event } from '@event-driven-io/emmett';
import { getPubSubMessageBus } from '../../src/messageBus/pubsubMessageBus';
import { InMemoryPubSub } from '../../src/testing';

type OrderPlaced = Event<'OrderPlaced', { orderId: string }>;

const orderPlaced = (orderId: string): OrderPlaced => ({
  type: 'OrderPlaced',
  data: { orderId },
});

const topicName = 'emmett-evt-OrderPlaced';

const spiesOn = (pubsub: InMemoryPubSub) => {
  const prototype = Object.getPrototypeOf(pubsub.topic('any')) as ReturnType<
    InMemoryPubSub['topic']
  >;
  return {
    topic: jest.spyOn(pubsub, 'topic'),
    getMetadata: jest.spyOn(prototype, 'getMetadata'),
    create: jest.spyOn(prototype, 'create'),
    publishMessage: jest.spyOn(prototype, 'publishMessage'),
  };
};

describe('Publishing - topics', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checks and creates a topic once, and keeps its topic object', async () => {
    const pubsub = new InMemoryPubSub();
    const spies = spiesOn(pubsub);
    const messageBus = getPubSubMessageBus({
      pubsub: pubsub as never,
      useEmulator: true,
    });

    await messageBus.publish(orderPlaced('order-1'));
    await messageBus.publish(orderPlaced('order-2'));
    await messageBus.publish(orderPlaced('order-3'));

    const topicCalls = spies.topic.mock.calls.filter(
      ([name]) => name === topicName,
    );
    expect(topicCalls).toHaveLength(1);
    expect(spies.getMetadata).toHaveBeenCalledTimes(1);
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.publishMessage).toHaveBeenCalledTimes(3);
  });

  it('does not create a topic that already exists', async () => {
    const pubsub = new InMemoryPubSub();
    await pubsub.topic(topicName).create();
    const spies = spiesOn(pubsub);
    const messageBus = getPubSubMessageBus({
      pubsub: pubsub as never,
      useEmulator: true,
    });

    await messageBus.publish(orderPlaced('order-1'));

    expect(spies.getMetadata).toHaveBeenCalledTimes(1);
    expect(spies.create).not.toHaveBeenCalled();
  });

  it('checks the topic again and publishes when it was deleted after the check', async () => {
    const pubsub = new InMemoryPubSub();
    const messageBus = getPubSubMessageBus({
      pubsub: pubsub as never,
      useEmulator: true,
    });
    const received: string[] = [];
    messageBus.subscribe((event: OrderPlaced) => {
      received.push(event.data.orderId);
      return Promise.resolve();
    }, 'OrderPlaced');
    await messageBus.start();
    await messageBus.publish(orderPlaced('order-1'));
    await pubsub.topic(topicName).delete();
    const spies = spiesOn(pubsub);

    await messageBus.publish(orderPlaced('order-2'));

    expect(spies.getMetadata).toHaveBeenCalledTimes(1);
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.publishMessage).toHaveBeenCalledTimes(2);
    await messageBus.close();
  });

  it('fails when the topic is missing and auto-create is disabled', async () => {
    const pubsub = new InMemoryPubSub();
    const messageBus = getPubSubMessageBus({
      pubsub: pubsub as never,
      useEmulator: true,
      autoCreateResources: false,
    });

    await expect(messageBus.publish(orderPlaced('order-1'))).rejects.toThrow(
      `Topic ${topicName} does not exist and autoCreateResources is disabled`,
    );
  });

  it('bounds every client call of a publication by the publish timeout', async () => {
    const pubsub = new InMemoryPubSub();
    const spies = spiesOn(pubsub);
    const messageBus = getPubSubMessageBus({
      pubsub: pubsub as never,
      useEmulator: true,
      publishTimeoutMs: 5000,
    });

    await messageBus.publish(orderPlaced('order-1'));

    expect(spies.topic).toHaveBeenCalledWith(topicName, {
      gaxOpts: { timeout: 5000 },
    });
    expect(spies.getMetadata).toHaveBeenCalledWith({ timeout: 5000 });
    expect(spies.create).toHaveBeenCalledWith({ timeout: 5000 });
  });

  it('keeps the client defaults without a publish timeout', async () => {
    const pubsub = new InMemoryPubSub();
    const spies = spiesOn(pubsub);
    const messageBus = getPubSubMessageBus({
      pubsub: pubsub as never,
      useEmulator: true,
    });

    await messageBus.publish(orderPlaced('order-1'));

    expect(spies.topic).toHaveBeenCalledWith(topicName, { gaxOpts: {} });
    expect(spies.getMetadata).toHaveBeenCalledWith({});
  });

  it.each([0, -1, Number.NaN])(
    'rejects a publish timeout of %p',
    (publishTimeoutMs) => {
      expect(() =>
        getPubSubMessageBus({
          pubsub: new InMemoryPubSub() as never,
          useEmulator: true,
          publishTimeoutMs,
        }),
      ).toThrow('publishTimeoutMs must be a positive number');
    },
  );
});
