# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
