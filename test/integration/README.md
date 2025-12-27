# Integration Tests

These tests run against an in-memory PubSub implementation. No emulator is required.

## Running

```bash
# Run all integration tests
npm run test:int

# Run a specific integration test file
npx jest test/integration/commands.int.spec.ts
npx jest test/integration/events.int.spec.ts
npx jest test/integration/scheduling.int.spec.ts
npx jest test/integration/messageBus.int.spec.ts
```

## Notes

- Integration tests validate the PubSub message bus behavior without external dependencies.
- End-to-end coverage against real emulators lives under `test/e2e` and uses Testcontainers.
