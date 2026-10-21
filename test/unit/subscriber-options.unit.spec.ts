import type { Topic } from '@google-cloud/pubsub';
import { getOrCreateSubscription } from '../../src';

const topicWith = (exists: boolean) => {
  const subscription = {
    exists: jest.fn().mockResolvedValue([exists]),
    create: jest.fn().mockResolvedValue([undefined]),
  };
  const topic = { subscription: jest.fn().mockReturnValue(subscription) };
  return { topic: topic as unknown as Topic, topicMock: topic, subscription };
};

describe('Subscriber (client) options', () => {
  const subscriber = { flowControl: { maxMessages: 5, allowExcessMessages: false } };

  it('passes them to the client subscription when it already exists', async () => {
    const { topic, topicMock, subscription } = topicWith(true);

    await getOrCreateSubscription(topic, 'sub', { subscriber });

    expect(topicMock.subscription).toHaveBeenCalledWith('sub', subscriber);
    expect(subscription.create).not.toHaveBeenCalled();
  });

  it('passes them when the subscription has to be created, and does not store them', async () => {
    const { topic, topicMock, subscription } = topicWith(false);

    await getOrCreateSubscription(topic, 'sub', { subscriber, ackDeadlineSeconds: 30 });

    expect(topicMock.subscription).toHaveBeenCalledWith('sub', subscriber);
    expect(subscription.create).toHaveBeenCalledWith({ ackDeadlineSeconds: 30 });
  });

  it('keeps working without them', async () => {
    const { topic, topicMock } = topicWith(true);

    await getOrCreateSubscription(topic, 'sub');

    expect(topicMock.subscription).toHaveBeenCalledWith('sub');
  });
});
