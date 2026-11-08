# Roadmap

Work planned for this library. All changes must be backward compatible. Status was checked against the code of version 0.6.0.

Legend: Done, Partial, Open.

| Item | Status | Evidence and note |
|---|---|---|
| Stable subscription id option for `subscribe` | Done | New bus `subscriptionId` config (0.6.0), normally the service name: `subscribe` names the subscription `<topicPrefix>-evt-<EventType>-<subscriptionId>`, so it survives restarts, replicas share it and all handlers of the service for one event type run on it. Without it the old random id is kept and a warning is logged outside the emulator. `subscribeWithOptions` covers the uncommon cases: another per-subscriber `subscriptionId`, `fanOut` (every replica receives every event), a topic prefix of its own and dead letter and retry policies |
| Expose the message id to handlers | Done | Handlers get `metadata.messageId` (0.6.0). A `metadata.messageId` already on the published event becomes the envelope id, so it stays stable across publications |
| Publish attributes `messageId`, `schemaVersion`, `traceparent` and keep the metadata on receipt | Done | Sent as attributes and read back into the handler metadata by `deserializeWithMetadata` (0.6.0). `deserialize` is unchanged. `timestamp` is still not exposed |
| Create the dead-letter topic when a subscription declares one and apply the retry policy | Done | The topic is created and referenced by its fully qualified name (0.6.0). Verified on the emulator. On a real project the Pub/Sub service agent still needs publisher rights on the dead letter topic and subscriber rights on the subscription, which belongs to infrastructure code |
| Ignore the already-exists race when a publisher creates a topic | Done | `publishMessage` ignores code 6 from `topic.create()` (0.6.0) |
| Remove or document the non-functional scheduling method | Done | Marked `@deprecated` with the reason (0.6.0): in emulator mode messages stay in memory, against real Pub/Sub they are published at once to a topic nothing consumes. Not removed, to stay backward compatible. A publish failure in `schedule` is now logged instead of becoming an unhandled rejection |
| Expose the acknowledgement deadline and flow control options of the client | Done | `subscriptionOptions.subscriber` is passed to the client subscription (0.6.0); `ackDeadlineSeconds` already set the stored deadline. The client does not treat flow control as a hard cap |
| Topic prefix configurable per bus | Done | `topicPrefix` in `PubSubMessageBusConfig` |
| Allow a subscriber to read topics published under a different prefix | Done | `topicPrefix` in the `subscribeWithOptions` options (0.6.0); the subscription itself keeps the bus prefix |
| Propagate trace context in message attributes | Partial | The publish span context is sent as `traceparent` and the handling span uses it as remote parent (0.6.0). Covered by unit tests of the encoding and by delivery of the attribute to handlers; not yet run end to end with a tracing SDK registered, where no `traceparent` is sent because span contexts are invalid |
| `/testing` entry with an in-memory implementation | Done | `InMemoryPubSub` and `createInMemoryMessageBus` exported as `/testing` (0.6.0). The fake now models competing consumers on one subscription and redelivery to a dead letter topic |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Library changes break services that already run on it | Regressions | Backward compatible changes only; services stay pinned to their version until they choose to upgrade |
| Duplicate delivery | Repeated reactions | Consumers deduplicate by `messageId`, which is why exposing it to handlers is on this list |

## Notes

- Competing consumers on real Pub/Sub: replicas that share a subscription lose no message, but exactly one replica per message is not guaranteed, so a handler must deduplicate by the `messageId` of the event to process it once. The emulator behaves differently (no duplicates, faster redelivery).
