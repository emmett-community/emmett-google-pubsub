import type { PubSub, Topic } from '@google-cloud/pubsub';
import type { Message } from '@event-driven-io/emmett';
import type { ScheduledMessageInfo } from './types';
import { serialize } from './serialization';

/**
 * Schedule options for messages
 */
export type ScheduleOptions = { afterInMs: number } | { at: Date };

/**
 * Scheduled message returned from dequeue
 */
export interface ScheduledMessage {
  message: Message;
  options?: ScheduleOptions;
}

/**
 * Scheduler configuration
 */
export interface SchedulerConfig {
  /**
   * Whether running in emulator mode
   */
  useEmulator: boolean;

  /**
   * PubSub client instance
   */
  pubsub: PubSub;

  /**
   * Topic for scheduled messages (optional, created if needed)
   */
  scheduledTopic?: Topic;

  /**
   * Topic prefix for naming
   * @default "emmett"
   */
  topicPrefix?: string;
}

/**
 * Calculate scheduled time from options
 *
 * @param options - Schedule options (afterInMs or at)
 * @returns The calculated scheduled time
 */
export function calculateScheduledTime(options?: ScheduleOptions): Date {
  if (!options) {
    return new Date();
  }

  if ('afterInMs' in options) {
    const now = new Date();
    return new Date(now.getTime() + options.afterInMs);
  }

  if ('at' in options) {
    return options.at;
  }

  return new Date();
}

/**
 * Filter messages that are ready for delivery
 *
 * @param pending - Array of pending scheduled messages
 * @param now - Current time
 * @returns Messages ready for delivery
 */
export function filterReadyMessages(
  pending: ScheduledMessageInfo[],
  now: Date,
): ScheduledMessageInfo[] {
  return pending.filter((msg) => msg.scheduledAt <= now);
}

/**
 * Message scheduler with dual mode support (production/emulator)
 */
export class MessageScheduler {
  private pendingMessages: ScheduledMessageInfo[] = [];
  private readonly useEmulator: boolean;
  private readonly pubsub: PubSub;
  private readonly topicPrefix: string;
  private scheduledTopic?: Topic;

  constructor(config: SchedulerConfig) {
    this.useEmulator = config.useEmulator;
    this.pubsub = config.pubsub;
    this.scheduledTopic = config.scheduledTopic;
    this.topicPrefix = config.topicPrefix ?? 'emmett';
  }

  /**
   * Schedule a message for future delivery
   *
   * In production mode: Publishes to PubSub with publishTime attribute
   * In emulator mode: Stores in memory for later dequeue (emulator doesn't support scheduling)
   *
   * @param message - The message to schedule
   * @param options - When to deliver the message
   */
  async schedule(message: Message, options?: ScheduleOptions): Promise<void> {
    const scheduledAt = calculateScheduledTime(options);

    if (this.useEmulator) {
      // Emulator mode: store in memory
      this.pendingMessages.push({
        message,
        options,
        scheduledAt,
      });
    } else {
      // Production mode: publish to PubSub with publishTime attribute
      await this.publishScheduledMessage(message, scheduledAt);
    }
  }

  /**
   * Dequeue ready scheduled messages (emulator mode only)
   *
   * Returns messages whose scheduled time has passed and removes them from pending queue
   *
   * @returns Array of scheduled messages ready for delivery
   */
  dequeue(): ScheduledMessage[] {
    if (!this.useEmulator) {
      // In production mode, PubSub handles scheduling, so dequeue returns empty
      return [];
    }

    const now = new Date();
    const ready = filterReadyMessages(this.pendingMessages, now);

    // Remove ready messages from pending queue
    this.pendingMessages = this.pendingMessages.filter(
      (msg) => msg.scheduledAt > now,
    );

    // Convert to ScheduledMessage format
    return ready.map((info) => ({
      message: info.message,
      options: info.options,
    }));
  }

  /**
   * Publish a scheduled message to PubSub (production mode)
   *
   * @param message - The message to publish
   * @param scheduledAt - When the message should be delivered
   */
  private async publishScheduledMessage(
    message: Message,
    scheduledAt: Date,
  ): Promise<void> {
    try {
      // Get or create the scheduled messages topic
      if (!this.scheduledTopic) {
        const topicName = `${this.topicPrefix}-scheduled-messages`;
        this.scheduledTopic = this.pubsub.topic(topicName);

        const [exists] = await this.scheduledTopic.exists();
        if (!exists) {
          await this.scheduledTopic.create();
        }
      }

      // Serialize the message
      const buffer = serialize(message);

      // Publish with custom attributes including publish time
      await this.scheduledTopic.publishMessage({
        data: buffer,
        attributes: {
          messageType: message.type,
          publishTime: scheduledAt.toISOString(),
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to publish scheduled message ${message.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Get count of pending scheduled messages (emulator mode only)
   *
   * @returns Number of pending scheduled messages
   */
  getPendingCount(): number {
    return this.useEmulator ? this.pendingMessages.length : 0;
  }

  /**
   * Clear all pending scheduled messages (emulator mode only, useful for testing)
   */
  clearPending(): void {
    if (this.useEmulator) {
      this.pendingMessages = [];
    }
  }
}
