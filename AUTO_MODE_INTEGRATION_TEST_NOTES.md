# Auto Mode Integration Test Notes (Client Team)

This checklist validates end-to-end client behavior against shard auto mode server logic.

## Scope
- Route under test: `shard.toggleAutoMode`
- Payload: `{ enabled: boolean }`
- Expected lifecycle: enable → server-driven movement → disable triggers (manual/spectate/explicit/expiry)

## Preconditions
- Test account can connect to shard and control one dragon.
- Client can issue tRPC mutation calls and receive shard broadcasts.
- Maintenance mode can be toggled by a mod account for policy verification.

## Base happy-path
1. Connect as normal player and ensure dragon is spawned.
2. Call `shard.toggleAutoMode` with `{ enabled: true }`.
3. Assert mutation succeeds.
4. Assert client receives broadcast: `Auto mode enabled`.
5. Observe movement for at least 10–20 seconds with no manual movement RPC spam.
6. Confirm server-driven movement appears natural (pattern changes over time, no persistent wall-sticking).

## Disable via explicit toggle
1. While auto mode is active, call `shard.toggleAutoMode` with `{ enabled: false }`.
2. Assert mutation succeeds.
3. Assert client receives broadcast: `Auto mode disabled`.
4. Confirm movement returns to manual control only.

## Disable via manual movement
1. Re-enable auto mode (`{ enabled: true }`).
2. Send manual movement update via `updateMyself`.
3. Assert auto mode is immediately cleared server-side.
4. Assert broadcast: `Auto mode disabled due to manual movement`.

## Disable via spectate transition
1. Re-enable auto mode (`{ enabled: true }`).
2. Enter spectate mode.
3. Assert auto mode clears.
4. Assert broadcast: `Auto mode disabled due to spectate`.

## Maintenance policy check
1. Enable maintenance mode (mod account).
2. As non-mod client, call `shard.toggleAutoMode` with `{ enabled: true }`.
3. Assert request is rejected with `Unauthorized`.
4. Confirm no `Auto mode enabled` broadcast is emitted.

## Reconnect continuity/dedupe check
1. Enable auto mode.
2. Disconnect client ungracefully (simulate drop).
3. Reconnect with same wallet/address identity.
4. Assert there is no duplicate auto session for old/new client ids.
5. Confirm auto mode state remains bound to the newest active client id only.

## 24h expiry behavior (recommended automation)
Because TTL is 24h, run this in an accelerated/instrumented environment when possible:
- Option A: use test harness stubs/fake timers.
- Option B: run shard in a debug profile with controlled time source (if available).

Validation points:
1. Auto mode remains active before expiry boundary.
2. At/after expiry, session is removed.
3. Broadcast emitted: `Auto mode expired`.
4. No further server-driven movement for that client.

## Multi-client sanity checks
- Run 3–10 concurrent auto clients in mixed map areas.
- Verify:
  - no visible event flood in client logs,
  - no obvious synchronized jitter lockstep,
  - no severe degradation in movement update cadence for manual players.

## Suggested evidence to attach to QA report
- Mutation request/response samples for enable/disable.
- Broadcast logs for each disable path.
- Short video/GIF of autonomous movement.
- Any anomalies with map collision or target snapping.
- Approximate server metrics during multi-client run (CPU/memory/tick timing).

## Known caveat
- Full shard monolithic TypeScript compile has host memory pressure in this environment; integration signoff should rely on focused tests + runtime smoke checks until build infra memory is raised.
