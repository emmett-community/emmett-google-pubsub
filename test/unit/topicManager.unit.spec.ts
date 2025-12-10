import type { PubSub, Subscription, Topic } from '@google-cloud/pubsub';
import {
  getCommandTopicName,
  getEventTopicName,
  getCommandSubscriptionName,
  getEventSubscriptionName,
  getOrCreateTopic,
  getOrCreateSubscription,
  deleteSubscription,
  deleteSubscriptions,
} from '../../src/messageBus/topicManager';

describe('TopicManager', () => {
  describe('Naming conventions', () => {
    describe('getCommandTopicName', () => {
      it('should generate command topic name with default prefix', () => {
        expect(getCommandTopicName('AddProductItem')).toBe(
          'emmett-cmd-AddProductItem',
        );
      });

      it('should generate command topic name with custom prefix', () => {
        expect(getCommandTopicName('AddProductItem', 'myapp')).toBe(
          'myapp-cmd-AddProductItem',
        );
      });
    });

    describe('getEventTopicName', () => {
      it('should generate event topic name with default prefix', () => {
        expect(getEventTopicName('ProductItemAdded')).toBe(
          'emmett-evt-ProductItemAdded',
        );
      });

      it('should generate event topic name with custom prefix', () => {
        expect(getEventTopicName('ProductItemAdded', 'myapp')).toBe(
          'myapp-evt-ProductItemAdded',
        );
      });
    });

    describe('getCommandSubscriptionName', () => {
      it('should generate command subscription name with default prefix', () => {
        expect(
          getCommandSubscriptionName('AddProductItem', 'instance-123'),
        ).toBe('emmett-cmd-AddProductItem-instance-123');
      });

      it('should generate command subscription name with custom prefix', () => {
        expect(
          getCommandSubscriptionName('AddProductItem', 'instance-123', 'myapp'),
        ).toBe('myapp-cmd-AddProductItem-instance-123');
      });
    });

    describe('getEventSubscriptionName', () => {
      it('should generate event subscription name with default prefix', () => {
        expect(
          getEventSubscriptionName('ProductItemAdded', 'sub-456'),
        ).toBe('emmett-evt-ProductItemAdded-sub-456');
      });

      it('should generate event subscription name with custom prefix', () => {
        expect(
          getEventSubscriptionName('ProductItemAdded', 'sub-456', 'myapp'),
        ).toBe('myapp-evt-ProductItemAdded-sub-456');
      });
    });
  });

  describe('Topic operations', () => {
    describe('getOrCreateTopic', () => {
      it('should return existing topic', async () => {
        const mockTopic = {
          exists: jest.fn().mockResolvedValue([true]),
          create: jest.fn(),
        } as unknown as Topic;

        const mockPubSub = {
          topic: jest.fn().mockReturnValue(mockTopic),
        } as unknown as PubSub;

        const topic = await getOrCreateTopic(mockPubSub, 'test-topic');

        expect(mockPubSub.topic).toHaveBeenCalledWith('test-topic');
        expect(mockTopic.exists).toHaveBeenCalled();
        expect(mockTopic.create).not.toHaveBeenCalled();
        expect(topic).toBe(mockTopic);
      });

      it('should create new topic if it does not exist', async () => {
        const mockTopic: Partial<Topic> = {
          exists: jest.fn().mockResolvedValue([false]),
          create: jest.fn(),
        };
        (mockTopic.create as jest.Mock).mockResolvedValue([mockTopic]);

        const mockPubSub = {
          topic: jest.fn().mockReturnValue(mockTopic),
        } as unknown as PubSub;

        const topic = await getOrCreateTopic(mockPubSub, 'test-topic');

        expect(mockPubSub.topic).toHaveBeenCalledWith('test-topic');
        expect(mockTopic.exists).toHaveBeenCalled();
        expect(mockTopic.create).toHaveBeenCalled();
        expect(topic).toBe(mockTopic);
      });

      it('should throw error if topic operations fail', async () => {
        const mockTopic = {
          exists: jest.fn().mockRejectedValue(new Error('Network error')),
        } as unknown as Topic;

        const mockPubSub = {
          topic: jest.fn().mockReturnValue(mockTopic),
        } as unknown as PubSub;

        await expect(
          getOrCreateTopic(mockPubSub, 'test-topic'),
        ).rejects.toThrow('Failed to get or create topic test-topic');
      });
    });
  });

  describe('Subscription operations', () => {
    describe('getOrCreateSubscription', () => {
      it('should return existing subscription', async () => {
        const mockSubscription = {
          exists: jest.fn().mockResolvedValue([true]),
          create: jest.fn(),
        } as unknown as Subscription;

        const mockTopic = {
          subscription: jest.fn().mockReturnValue(mockSubscription),
        } as unknown as Topic;

        const subscription = await getOrCreateSubscription(
          mockTopic,
          'test-subscription',
        );

        expect(mockTopic.subscription).toHaveBeenCalledWith('test-subscription');
        expect(mockSubscription.exists).toHaveBeenCalled();
        expect(mockSubscription.create).not.toHaveBeenCalled();
        expect(subscription).toBe(mockSubscription);
      });

      it('should create new subscription if it does not exist', async () => {
        const mockSubscription: Partial<Subscription> = {
          exists: jest.fn().mockResolvedValue([false]),
          create: jest.fn(),
        };
        (mockSubscription.create as jest.Mock).mockResolvedValue([mockSubscription]);

        const mockTopic = {
          subscription: jest.fn().mockReturnValue(mockSubscription),
        } as unknown as Topic;

        const subscription = await getOrCreateSubscription(
          mockTopic,
          'test-subscription',
        );

        expect(mockTopic.subscription).toHaveBeenCalledWith('test-subscription');
        expect(mockSubscription.exists).toHaveBeenCalled();
        expect(mockSubscription.create).toHaveBeenCalledWith({});
        expect(subscription).toBe(mockSubscription);
      });

      it('should create subscription with options', async () => {
        const mockSubscription: Partial<Subscription> = {
          exists: jest.fn().mockResolvedValue([false]),
          create: jest.fn(),
        };
        (mockSubscription.create as jest.Mock).mockResolvedValue([mockSubscription]);

        const mockTopic = {
          subscription: jest.fn().mockReturnValue(mockSubscription),
        } as unknown as Topic;

        const options = {
          ackDeadlineSeconds: 60,
          retryPolicy: {
            minimumBackoff: { seconds: 10 },
            maximumBackoff: { seconds: 600 },
          },
          deadLetterPolicy: {
            deadLetterTopic: 'emmett-dlq',
            maxDeliveryAttempts: 5,
          },
        };

        await getOrCreateSubscription(mockTopic, 'test-subscription', options);

        expect(mockSubscription.create).toHaveBeenCalledWith({
          ackDeadlineSeconds: 60,
          retryPolicy: {
            minimumBackoff: { seconds: 10 },
            maximumBackoff: { seconds: 600 },
          },
          deadLetterPolicy: {
            deadLetterTopic: 'emmett-dlq',
            maxDeliveryAttempts: 5,
          },
        });
      });

      it('should throw error if subscription operations fail', async () => {
        const mockSubscription = {
          exists: jest.fn().mockRejectedValue(new Error('Network error')),
        } as unknown as Subscription;

        const mockTopic = {
          subscription: jest.fn().mockReturnValue(mockSubscription),
        } as unknown as Topic;

        await expect(
          getOrCreateSubscription(mockTopic, 'test-subscription'),
        ).rejects.toThrow(
          'Failed to get or create subscription test-subscription',
        );
      });
    });

    describe('deleteSubscription', () => {
      it('should delete existing subscription', async () => {
        const mockSubscription = {
          exists: jest.fn().mockResolvedValue([true]),
          delete: jest.fn().mockResolvedValue([]),
        } as unknown as Subscription;

        await deleteSubscription(mockSubscription);

        expect(mockSubscription.exists).toHaveBeenCalled();
        expect(mockSubscription.delete).toHaveBeenCalled();
      });

      it('should not delete if subscription does not exist', async () => {
        const mockSubscription = {
          exists: jest.fn().mockResolvedValue([false]),
          delete: jest.fn(),
        } as unknown as Subscription;

        await deleteSubscription(mockSubscription);

        expect(mockSubscription.exists).toHaveBeenCalled();
        expect(mockSubscription.delete).not.toHaveBeenCalled();
      });

      it('should not throw on delete error', async () => {
        const consoleWarnSpy = jest
          .spyOn(console, 'warn')
          .mockImplementation(() => {});

        const mockSubscription = {
          exists: jest.fn().mockResolvedValue([true]),
          delete: jest.fn().mockRejectedValue(new Error('Delete failed')),
        } as unknown as Subscription;

        await expect(
          deleteSubscription(mockSubscription),
        ).resolves.toBeUndefined();

        expect(consoleWarnSpy).toHaveBeenCalled();

        consoleWarnSpy.mockRestore();
      });
    });

    describe('deleteSubscriptions', () => {
      it('should delete multiple subscriptions', async () => {
        const mockSub1 = {
          exists: jest.fn().mockResolvedValue([true]),
          delete: jest.fn().mockResolvedValue([]),
        } as unknown as Subscription;

        const mockSub2 = {
          exists: jest.fn().mockResolvedValue([true]),
          delete: jest.fn().mockResolvedValue([]),
        } as unknown as Subscription;

        await deleteSubscriptions([mockSub1, mockSub2]);

        expect(mockSub1.delete).toHaveBeenCalled();
        expect(mockSub2.delete).toHaveBeenCalled();
      });

      it('should handle empty array', async () => {
        await expect(deleteSubscriptions([])).resolves.toBeUndefined();
      });
    });
  });
});
