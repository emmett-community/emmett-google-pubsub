import {
  context,
  isSpanContextValid,
  trace,
  TraceFlags,
  type Context,
  type SpanContext,
} from '@opentelemetry/api';

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

/**
 * W3C `traceparent` value for a span context, or undefined when the context is not valid
 * (for example when no tracing SDK is registered).
 */
export function toTraceparent(spanContext: SpanContext): string | undefined {
  if (!isSpanContextValid(spanContext)) {
    return undefined;
  }
  const flags = (spanContext.traceFlags & 0xff).toString(16).padStart(2, '0');
  return `00-${spanContext.traceId}-${spanContext.spanId}-${flags}`;
}

/**
 * Parses a W3C `traceparent` value into a remote span context, or undefined if malformed.
 */
export function parseTraceparent(
  value: string | undefined,
): SpanContext | undefined {
  const match = value ? TRACEPARENT.exec(value) : null;
  if (!match) {
    return undefined;
  }
  const spanContext: SpanContext = {
    traceId: match[1],
    spanId: match[2],
    traceFlags: parseInt(match[3], 16) & TraceFlags.SAMPLED,
    isRemote: true,
  };
  return isSpanContextValid(spanContext) ? spanContext : undefined;
}

/**
 * Context whose active span is the remote parent described by `traceparent`; the current
 * context when the value is missing or malformed.
 */
export function contextFromTraceparent(value: string | undefined): Context {
  const spanContext = parseTraceparent(value);
  return spanContext
    ? trace.setSpanContext(context.active(), spanContext)
    : context.active();
}
