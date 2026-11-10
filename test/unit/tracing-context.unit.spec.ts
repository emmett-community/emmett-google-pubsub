import type { Message as PubSubMessage } from '@google-cloud/pubsub';
import type {
  AnyMessage,
  Event,
  SingleRawMessageHandlerWithoutContext,
} from '@event-driven-io/emmett';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import {
  handleCommandMessage,
  handleEventMessage,
} from '../../src/messageBus/messageHandler';
import { getPubSubMessageBus } from '../../src/messageBus/pubsubMessageBus';
import { serialize } from '../../src/messageBus/serialization';
import { InMemoryPubSub } from '../../src/testing';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

const exporter = new InMemorySpanExporter();
const contextManager = new AsyncLocalStorageContextManager();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));

const activeSpanId = () => trace.getActiveSpan()?.spanContext().spanId;
const finished = (name: string): ReadableSpan[] =>
  exporter.getFinishedSpans().filter((span) => span.name === name);

const messageOf = (
  payload: AnyMessage,
  attributes: Record<string, string> = {},
): PubSubMessage =>
  ({
    data: serialize(payload),
    attributes,
    deliveryAttempt: 1,
    ack: jest.fn(),
    nack: jest.fn(),
  }) as unknown as PubSubMessage;

const handlersOf = (
  type: string,
  handler: SingleRawMessageHandlerWithoutContext<AnyMessage>,
) =>
  new Map<string, SingleRawMessageHandlerWithoutContext<AnyMessage>[]>([
    [type, [handler]],
  ]);

describe('Tracing context', () => {
  beforeAll(() => {
    provider.register({ contextManager: contextManager.enable() });
  });

  afterEach(() => {
    exporter.reset();
  });

  afterAll(async () => {
    await provider.shutdown();
    contextManager.disable();
    trace.disable();
    context.disable();
  });

  it('runs an event handler with the handling span active, as a child of the traceparent', async () => {
    let seen: string | undefined;
    const handler = jest.fn(() => {
      seen = activeSpanId();
      return Promise.resolve();
    });

    await handleEventMessage(
      messageOf(
        { type: 'TestEvent', data: {} },
        { traceparent: `00-${TRACE_ID}-${SPAN_ID}-01` },
      ),
      handlersOf('TestEvent', handler),
      'TestEvent',
    );

    const [handling] = finished('emmett.pubsub.handle_event');
    expect(seen).toBe(handling.spanContext().spanId);
    expect(handling.spanContext().traceId).toBe(TRACE_ID);
    expect(handling.parentSpanId).toBe(SPAN_ID);
  });

  it('runs a command handler with the handling span active', async () => {
    let seen: string | undefined;
    const handler = jest.fn(() => {
      seen = activeSpanId();
      return Promise.resolve();
    });

    await handleCommandMessage(
      messageOf({ type: 'TestCommand', data: {} }),
      handlersOf('TestCommand', handler),
      'TestCommand',
    );

    const [handling] = finished('emmett.pubsub.handle_command');
    expect(seen).toBe(handling.spanContext().spanId);
  });

  it('starts a trace of its own for a message without traceparent, whatever span is active', async () => {
    const outer = trace.getTracer('test').startSpan('outer');

    await context.with(trace.setSpan(context.active(), outer), () =>
      handleEventMessage(
        messageOf({ type: 'TestEvent', data: {} }),
        handlersOf('TestEvent', () => Promise.resolve()),
        'TestEvent',
      ),
    );
    outer.end();

    const [handling] = finished('emmett.pubsub.handle_event');
    expect(handling.parentSpanId).toBeUndefined();
    expect(handling.spanContext().traceId).not.toBe(
      outer.spanContext().traceId,
    );
  });

  it('publishes with the publication span active and handles the event under it', async () => {
    const pubsub = new InMemoryPubSub();
    const topicPrototype = Object.getPrototypeOf(
      pubsub.topic('any'),
    ) as ReturnType<InMemoryPubSub['topic']>;
    const publishMessage = topicPrototype.publishMessage;
    let seenByClient: string | undefined;
    const spy = jest
      .spyOn(topicPrototype, 'publishMessage')
      .mockImplementation(function (this: unknown, request) {
        seenByClient = activeSpanId();
        return publishMessage.call(this, request);
      });

    const messageBus = getPubSubMessageBus({
      pubsub: pubsub as never,
      useEmulator: true,
    });
    let seenByHandler: string | undefined;
    let markHandled: () => void = () => undefined;
    const handled = new Promise<void>((resolve) => {
      markHandled = resolve;
    });
    messageBus.subscribe((_event: Event) => {
      seenByHandler = activeSpanId();
      markHandled();
      return Promise.resolve();
    }, 'TestEvent');
    await messageBus.start();

    await trace
      .getTracer('test')
      .startActiveSpan('request', async (request) => {
        await messageBus.publish({ type: 'TestEvent', data: {} });
        request.end();
      });
    await handled;
    await messageBus.close();
    spy.mockRestore();

    const [request] = finished('request');
    const [publication] = finished('emmett.pubsub.publish_event');
    const [handling] = finished('emmett.pubsub.handle_event');
    expect(publication.parentSpanId).toBe(request.spanContext().spanId);
    expect(seenByClient).toBe(publication.spanContext().spanId);
    expect(handling.parentSpanId).toBe(publication.spanContext().spanId);
    expect(handling.spanContext().traceId).toBe(request.spanContext().traceId);
    expect(seenByHandler).toBe(handling.spanContext().spanId);
  });
});
