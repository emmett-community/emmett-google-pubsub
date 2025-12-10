# Integration Tests

This directory contains integration tests for the Google Pub/Sub message bus implementation.

## Prerequisites

Integration tests require a running Google Cloud Pub/Sub emulator. There are two ways to run it:

### Option 1: Using Docker (Recommended)

```bash
# Run PubSub emulator in Docker
docker run -d \
  --name pubsub-emulator \
  -p 8085:8085 \
  gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators \
  gcloud beta emulators pubsub start \
  --project=test-project \
  --host-port=0.0.0.0:8085
```

### Option 2: Using gcloud CLI

```bash
# Install gcloud components
gcloud components install pubsub-emulator

# Start emulator
gcloud beta emulators pubsub start \
  --project=test-project \
  --host-port=localhost:8085
```

## Running Integration Tests

Once the emulator is running:

```bash
# Run all integration tests
npm run test:integration

# Run specific integration test file
npx jest test/integration/commands.int.spec.ts
npx jest test/integration/events.int.spec.ts
npx jest test/integration/scheduling.int.spec.ts
npx jest test/integration/messageBus.int.spec.ts
```

## Environment Variables

The tests use the following environment variables (defaults shown):

```bash
PUBSUB_PROJECT_ID=test-project
PUBSUB_EMULATOR_HOST=localhost:8085
```

You can override these in your test environment:

```bash
PUBSUB_PROJECT_ID=my-project npm run test:integration
```

## Test Structure

- **commands.int.spec.ts**: Tests command registration, handling, and error scenarios
- **events.int.spec.ts**: Tests event subscription, publishing, and multiple subscribers
- **scheduling.int.spec.ts**: Tests message scheduling in emulator mode
- **messageBus.int.spec.ts**: Tests full lifecycle, workflows, and performance

## Cleanup

After running tests, stop the emulator:

```bash
# Docker
docker stop pubsub-emulator
docker rm pubsub-emulator

# gcloud CLI
# Press Ctrl+C to stop the emulator
```

## Troubleshooting

### Emulator not responding

Make sure the emulator is running and accessible:

```bash
# Check if emulator is listening
curl http://localhost:8085
```

### Tests timing out

Increase Jest timeout in test files or run with higher timeout:

```bash
jest --testTimeout=60000 test/integration
```

### Port already in use

If port 8085 is already in use, stop any running emulator instances:

```bash
# Find process using port 8085
lsof -i :8085

# Kill the process
kill -9 <PID>
```

## CI/CD Integration

For CI/CD pipelines, use the Docker approach with Docker Compose:

```yaml
# docker-compose.test.yml
version: '3.8'
services:
  pubsub:
    image: gcr.io/google.com/cloudsdktool/google-cloud-cli:emulators
    ports:
      - "8085:8085"
    command: gcloud beta emulators pubsub start --project=test-project --host-port=0.0.0.0:8085
```

Then run tests:

```bash
docker-compose -f docker-compose.test.yml up -d
npm run test:integration
docker-compose -f docker-compose.test.yml down
```
