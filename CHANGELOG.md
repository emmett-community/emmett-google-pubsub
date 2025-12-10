# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial package setup and configuration
- Type definitions for PubSub message bus
- Message serialization/deserialization with Date handling
- Topic and subscription management utilities
- Full MessageBus implementation with command/event routing
- Dual-mode scheduler (production Cloud Scheduler + emulator in-memory)
- Lifecycle management (start/close methods)
- 91 unit tests (95%+ coverage)
- 46 integration tests (100% passing)
- Shopping cart example demonstrating drop-in replacement for in-memory message bus
- PubSub emulator UI integration in docker-compose

### Fixed

- Message kind classification bug where events with "command" in name were misclassified
- Race conditions in topic/subscription creation (ALREADY_EXISTS errors)
- Event subscriber isolation (each subscriber gets own subscription)

## [0.1.0] - TBD

### Initial Release

- Initial release (in development)
