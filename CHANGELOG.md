# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - Unreleased

### Added

- `subscriptionId` config on the bus, normally the service name. With it, `subscribe` names the Pub/Sub subscription `<topicPrefix>-evt-<EventType>-<subscriptionId>`: it survives restarts (events published while the service was down are delivered), replicas of the service share it (an event normally goes to one replica, but can be delivered again, so handlers must be idempotent), and all handlers of the service for one event type run on the one subscription. Without it the previous behavior is kept (random id per subscriber, nothing survives a restart) and a warning is logged outside the emulator.
- `subscribeWithOptions(handler, eventTypes, options)` for the uncommon cases: a `subscriptionId` other than the bus one, `fanOut` (every replica receives every event, for example to keep an in-memory cache current), a per-subscriber `topicPrefix` and per-subscriber `deadLetterPolicy` and `retryPolicy`.
- Handlers receive `metadata.messageId`. A `metadata.messageId` already present on the published event (for example the event store one) is used as the envelope id, so it is stable across publications.
- `messageId`, `schemaVersion` and `traceparent` are published as message attributes and read back into the handler metadata (`deserializeWithMetadata`). The handling span uses the received `traceparent` as remote parent.
- The dead letter topic is created when a subscription declares one, and referenced by its fully qualified name.
- `subscriptionOptions.subscriber` passes the Pub/Sub client subscriber options through (flow control, client-side acknowledgement deadline). They apply to the process and are not stored on the subscription.
- `@emmett-community/emmett-google-pubsub/testing` entry exporting `InMemoryPubSub` and `createInMemoryMessageBus`. The fake models competing consumers on one subscription and redelivery to a dead letter topic.

### Fixed

- `schedule` no longer turns a publish failure into an unhandled promise rejection: it is logged.
- Publishing no longer fails when another publisher creates the topic between the existence check and `topic.create()` (ALREADY_EXISTS).

### Deprecated

- `schedule` and `dequeue`: in emulator mode they keep messages in memory, and against real Pub/Sub `schedule` publishes at once to a `<topicPrefix>-scheduled-messages` topic that nothing consumes, because Pub/Sub has no delayed delivery. Messages are never delivered at the requested time. Use Cloud Scheduler and Cloud Tasks, as `scheduled-jobs.md` and ADR-006 define.

## [0.5.0] - 2026-09-27

### Added

- Subscription liveness watchdog that periodically checks each subscription is still reachable and transparently recreates it (and its topic, if that was also lost) if a check fails. New `watchdog` option in `SubscriptionOptions`, enabled by default.
- `setupTimeoutMs` option in `SubscriptionOptions` bounding how long topic/subscription existence checks and creation may take during `start()`.

### Fixed

- The underlying streaming-pull connection could go silently dead after a network interruption (e.g. an idle NAT/firewall timeout) without ever emitting the subscription's `error` event, leaving message delivery stopped permanently until the process was restarted. The watchdog now detects and recovers from this.
- Topic/subscription setup calls (`exists`, `create`) had no timeout of their own: a dead connection at `start()` time could block the entire message bus - and anything awaiting it - from ever starting.

## [0.4.0] - 2026-01-15

### Changed

- Shopping cart example now pins the Firebase emulator service to `linux/amd64`, enables `LOG_HTTP_ENABLED`, and keeps the emulated stack healthy for modern development machines.
- Example dependencies were updated to the latest `@emmett-community` bundles (Express/OpenAPI, Firestore, Realtime DB, Observability) along with `firebase-admin`/`pino-http`, matching the node 18+ runtime in this release.
- Example wiring of the Firestore event store now wraps `getFirestoreEventStore` with `asEventStore` before passing it to `wireRealtimeDBProjections`, keeping TypeScript satisfied while reusing the shared projections.

## [0.3.0] - 2025-12-31

### Added

- OpenTelemetry tracing spans for key operations (`start`, `close`, `send_command`, `publish_event`, `handle_command`, `handle_event`)
- Optional `Logger` interface compatible with Pino, Winston, and console
- New `observability` option in `PubSubMessageBusConfig` for opt-in logging
- New dependency `@opentelemetry/api`

### Changed

- Replaced `console.*` logging with optional structured logging via `safeLog` helper
- Package now operates silently by default (opt-in logging model)
- Functions `handleCommandMessage`, `handleEventMessage`, `createMessageListener`, `deleteSubscription`, and `deleteSubscriptions` now accept optional `logger` parameter

## [0.2.0] - 2025-12-27

### Added

- In-memory PubSub test helper for integration tests
- Testcontainers-based E2E coverage for PubSub message bus
- Firebase emulator configs under `test/support/firebase`
- GitHub Actions workflows for build/test and publish
- In-memory Firestore/Realtime DB/PubSub helpers for shopping-cart integration tests
- Example Firebase configs under `examples/shopping-cart/test/support/firebase`

### Changed

- Integration tests now use in-memory PubSub
- Example E2E tests run against Firebase emulators via Testcontainers
- Example docker-compose uses `myfstartup/firebase-emulator-suite:15` image
- Example OpenAPI spec moved under `examples/shopping-cart/src`
- Example Firebase configs moved under `examples/shopping-cart/test/support/firebase`
- Example dependencies updated to Emmett 0.2.0 packages

### Removed

- `examples/shopping-cart/Dockerfile.firebase`
- `examples/shopping-cart/.env.example`

## [0.1.0] - 2024-12-18

### Added

- Initial package setup and configuration
- Type definitions for PubSub message bus (`PubSubMessageBusConfig`, `SubscriptionOptions`, `PubSubMessageEnvelope`)
- Message serialization/deserialization with Date handling
- Topic and subscription management utilities
- Full MessageBus implementation with command/event routing
- Dual-mode scheduler (production Cloud Scheduler + emulator in-memory)
- Lifecycle management (`start()`, `close()`, `isStarted()`)
- Producer-only mode (send/publish without start)
- 91 unit tests (95%+ coverage)
- 46 integration tests (100% passing)
- Shopping cart example demonstrating drop-in replacement for in-memory message bus
- PubSub emulator UI integration in docker-compose
- Complete documentation (API, Architecture, Examples)

### Fixed

- Message kind classification bug where events with "command" in name were misclassified
- Race conditions in topic/subscription creation (ALREADY_EXISTS errors)
- Event subscriber isolation (each subscriber gets own subscription)
