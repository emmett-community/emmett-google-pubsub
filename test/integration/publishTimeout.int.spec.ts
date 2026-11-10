import { PubSub } from '@google-cloud/pubsub';
import { getPubSubMessageBus } from '../../src/messageBus/pubsubMessageBus';

// The real client, pointed at an address where nothing answers: every call fails with a
// retryable error, so only the publish timeout ends the publication
describe('Publish timeout with the Pub/Sub client', () => {
  it('fails the publication within the publish timeout when Pub/Sub does not answer', async () => {
    const pubsub = new PubSub({
      projectId: 'demo-project',
      apiEndpoint: '127.0.0.1:1',
      emulatorMode: true,
    });
    const messageBus = getPubSubMessageBus({
      pubsub,
      useEmulator: true,
      publishTimeoutMs: 1000,
    });
    const startedAt = Date.now();

    await expect(
      messageBus.publish({ type: 'OrderPlaced', data: { orderId: 'order-1' } }),
    ).rejects.toMatchObject({ code: 4 });

    expect(Date.now() - startedAt).toBeLessThan(5000);
    await pubsub.close();
  }, 30000);
});
