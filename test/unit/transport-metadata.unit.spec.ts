import type { Event } from '@event-driven-io/emmett';
import {
  deserialize,
  deserializeWithMetadata,
  parseTraceparent,
  serialize,
  toTraceparent,
} from '../../src';

type Sample = Event<'Sample', { id: string }>;

const sample = (metadata?: Record<string, unknown>): Sample =>
  ({
    type: 'Sample',
    data: { id: '1' },
    ...(metadata && { metadata }),
  }) as Sample;

const metadataOf = (message: unknown) =>
  (message as { metadata?: Record<string, unknown> }).metadata;

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SPAN_ID = '00f067aa0ba902b7';

describe('Transport metadata', () => {
  describe('serialize', () => {
    it('uses the given message id in the envelope', () => {
      const envelope = JSON.parse(
        serialize(sample(), 'store-1').toString(),
      ) as { messageId: string };

      expect(envelope.messageId).toBe('store-1');
    });

    it('generates a message id when none is given', () => {
      const envelope = JSON.parse(serialize(sample()).toString()) as {
        messageId: string;
      };

      expect(envelope.messageId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('deserialize', () => {
    it('is unchanged: metadata comes back as published, undefined when absent', () => {
      expect(
        metadataOf(deserialize<Sample>(serialize(sample()))),
      ).toBeUndefined();
      expect(
        metadataOf(deserialize<Sample>(serialize(sample({ a: 1 })))),
      ).toEqual({ a: 1 });
    });
  });

  describe('deserializeWithMetadata', () => {
    it('adds the envelope message id to the metadata', () => {
      const message = deserializeWithMetadata<Sample>(
        serialize(sample({ a: 1 }), 'm-1'),
      );

      expect(metadataOf(message)).toEqual({ a: 1, messageId: 'm-1' });
    });

    it('adds the message id even when the message had no metadata', () => {
      const message = deserializeWithMetadata<Sample>(
        serialize(sample(), 'm-2'),
      );

      expect(metadataOf(message)).toEqual({ messageId: 'm-2' });
    });

    it('keeps the event messageId from the published metadata over the envelope one', () => {
      const event = sample({ messageId: 'event-store-1' });
      const envelope = JSON.parse(
        serialize(event, 'publication-1').toString(),
      ) as { messageId: string };
      expect(envelope.messageId).toBe('publication-1');

      const message = deserializeWithMetadata<Sample>(
        serialize(event, 'publication-1'),
      );

      expect(metadataOf(message)).toMatchObject({ messageId: 'event-store-1' });
    });

    it('takes schemaVersion and traceparent from the attributes', () => {
      const message = deserializeWithMetadata<Sample>(
        serialize(sample(), 'm-3'),
        {
          schemaVersion: '2',
          traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
        },
      );

      expect(metadataOf(message)).toMatchObject({
        messageId: 'm-3',
        schemaVersion: '2',
        traceparent: `00-${TRACE_ID}-${SPAN_ID}-01`,
      });
    });

    it('keeps a schemaVersion already present in the published metadata', () => {
      const message = deserializeWithMetadata<Sample>(
        serialize(sample({ schemaVersion: 3 })),
        {
          schemaVersion: '2',
        },
      );

      expect(metadataOf(message)).toMatchObject({ schemaVersion: 3 });
    });

    it('keeps the data and type untouched', () => {
      const message = deserializeWithMetadata<Sample>(serialize(sample()));

      expect(message.type).toBe('Sample');
      expect(message.data).toEqual({ id: '1' });
    });
  });

  describe('traceparent', () => {
    it('formats a valid span context', () => {
      expect(
        toTraceparent({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1 }),
      ).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`);
    });

    it('returns undefined for the invalid (no SDK) span context', () => {
      expect(
        toTraceparent({
          traceId: '0'.repeat(32),
          spanId: '0'.repeat(16),
          traceFlags: 0,
        }),
      ).toBeUndefined();
    });

    it('parses what it formats, as a remote context', () => {
      const parsed = parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-01`);

      expect(parsed).toEqual({
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        traceFlags: 1,
        isRemote: true,
      });
    });

    it.each([
      undefined,
      '',
      'garbage',
      `01-${TRACE_ID}-${SPAN_ID}-01`,
      `00-${TRACE_ID}-${SPAN_ID}`,
    ])('rejects %p', (value) => {
      expect(parseTraceparent(value)).toBeUndefined();
    });
  });
});
