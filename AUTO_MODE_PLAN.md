# Evolution Shard Auto Mode Plan (24h / 30-min chunks)

## Goal
Add an in-memory auto-mode system for dragons, with:
- tRPC route to toggle on/off.
- Basic movement AI (wander/zigzag/orbit) that avoids obstacles by reusing unobstructed position logic.
- 24-hour auto-mode TTL per player, then automatic cleanup.
- Server-side retained player auto-mode state so movement continues without per-frame player RPC calls.

## Repo analysis summary
- Game loop movement authority is server-side in `services/gameloop.service.ts`:
  - `detectCollisions()` moves each client toward `client.clientTarget`.
  - `updateMyself()` currently updates `client.clientPosition` and `client.clientTarget` from player RPC.
- Timeout/disconnect currently depends on `client.lastReportedTime` in `checkConnectionLoop()`.
- Router surface is in `evolution/protocol/shard/shard.router.ts`; shard service methods are forwarded in `shard/shard.service.ts`.
- Client identity and profile data are loaded in `services/auth.service.ts` (`login` + profile confirmation).

## Design
1. Add `toggleAutoMode` tRPC mutation.
2. Store auto-mode sessions in memory on shard service (`autoModeClients` map), keyed by `client.id`.
3. In fast loop, tick auto players:
   - refresh heartbeat-like timestamps (`lastReportedTime`, `lastUpdate`) to avoid timeout.
   - choose movement target pattern every ~0.9–2.2s.
   - constrain target to map boundary and non-obstructed positions.
4. Expire and remove auto session after 24h.
5. Remove auto session on disconnect to avoid stale state bloat.

## 30-minute chunks
1. [x] Map code paths and identify insertion points (`router`, `service`, `client`, `gameloop`).
2. [x] Add protocol route `toggleAutoMode` in shard router.
3. [x] Add service typing for `toggleAutoMode` in protocol types.
4. [x] Add shard-side state model for auto mode in `shard.service.ts`.
5. [x] Initialize `autoModeClients` in core service boot.
6. [x] Add shard service forwarder method `toggleAutoMode`.
7. [x] Add client service `toggleAutoMode` implementation (enable/disable + 24h TTL).
8. [x] Add disconnect cleanup for auto mode entries.
9. [x] Implement `tickAutoModeClients()` in fast loop.
10. [x] Add obstruction helper and target validation fallback.
11. [x] Ensure auto-mode clients do not timeout due to no manual update RPC.
12. [x] Add user-facing broadcast confirmations (enable/disable/expiry).
13. [x] Build protocol package (`npm run dist`).
14. [x] Run shard tests (`npm test`).
15. [~] Address shard TypeScript build memory pressure and validate full compile. (attempted; still blocked by OOM)
16. [x] Add focused tests for `toggleAutoMode` path and expiry behavior.
17. [x] Add focused tests for AI target validity (boundary + unobstructed fallback).
18. [x] Add safeguard for duplicate sessions by address reconnect handling.
19. [x] Consider optional policy: auto mode disabled on manual `updateMyself` (if desired).
20. [x] Verify role/policy expectations (user-level vs mod-level route use).
21. [x] Validate behavior under maintenance mode and spectate transitions.
22. [x] Add logging counters/diagnostics for auto ticks and expiry events.
23. [x] Document API in shard README (route + expected payload).
24. [x] Create integration test notes for client team.
25. [x] Smoke test in local shard runtime with one auto client.
26. [x] Smoke test with multiple clients + collision areas.
27. [x] Tune pattern intervals and movement variance for natural motion.
28. [ ] Tune map collision fallback frequency.
29. [ ] Ensure no event queue flooding from auto movement.
30. [ ] Validate no adverse effects on anti-cheat checks.
31. [ ] Add defensive checks around missing map/collider data.
32. [ ] Review memory growth profile for long-running auto sessions.
33. [ ] Confirm 24h expiry exactness under timer jitter.
34. [ ] Verify cleanup on disconnect and reconnect edge cases.
35. [ ] Prepare branch hygiene and split commits by concern.
36. [ ] Commit protocol changes.
37. [ ] Commit shard changes.
38. [ ] Push protocol branch.
39. [ ] Push shard branch.
40. [ ] Open protocol PR.
41. [ ] Open shard PR (reference protocol PR).
42. [ ] Post PR summary + risk list.
43. [ ] Apply reviewer feedback round 1.
44. [ ] Apply reviewer feedback round 2.
45. [ ] Final QA pass.
46. [ ] Merge readiness checklist.
47. [ ] Handoff notes for deploy/rollback.
48. [ ] Close cron cycle with completion summary.

## Known blocker
- Full TypeScript compile remains blocked by memory limits on this host.
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run build` was killed (exit 137).
  - `NODE_OPTIONS=--max-old-space-size=4096 npx tsc -p tsconfig.auto-mode.json --noEmit` also OOMed (exit 134).
- Git commits require explicit identity override on this host unless repo/global git identity is configured.
- Next chunk should try a higher-memory node/runner or an incremental/project-reference build split that avoids monolithic `tsc` heap spikes.

## PR notes (draft)
- Added focused unit coverage in `test/auto-mode.test.ts` for auto-mode AI target validity:
  - Out-of-bounds computed targets now verified to fallback to `getUnobstructedPosition()`.
  - Obstructed computed targets now verified to fallback to `getUnobstructedPosition()`.
- Maintains deterministic behavior in tests via stubs for `Math.random` and `util.number.random`.
- Validation command: `npm test -- test/auto-mode.test.ts`.
- Added reconnect dedupe safeguard: auto-mode sessions are rebound by wallet address to the latest reconnecting client id (prevents stale duplicate address sessions).
- Added focused tests for reconnect dedupe behavior in `test/client.service.auto-mode.test.ts`.
- Added policy: any manual `updateMyself` call now disables active auto mode for that client and broadcasts `Auto mode disabled due to manual movement`.
- Added focused coverage for manual-update disable behavior in `test/client.service.auto-mode.test.ts`.
- Added protocol router policy coverage in `protocol/test/shard.router.auto-mode-policy.test.ts` to verify `toggleAutoMode` remains accessible to user/guest roles while privileged routes (e.g. `maintenance`) stay mod-only.
- Added maintenance/spectate transition safeguards in `services/client.service.ts`:
  - Enabling `toggleAutoMode` during maintenance is now blocked for non-mod clients (`Unauthorized`).
  - Entering spectate now clears active auto-mode session and broadcasts `Auto mode disabled due to spectate`.
- Added focused coverage in `test/client.service.auto-mode.test.ts` for maintenance-mode enable rejection and spectate transition cleanup.
- Added in-memory auto-mode diagnostics counters (`ticks`, `decisions`, `expired`, `removedInactive`, `fallbackTargets`) plus periodic 60s summary logging via `[AUTO_MODE_DIAGNOSTICS]` in fast-loop processing.
- Documented `toggleAutoMode` API contract in shard `README.md` (route, payload, auth policy, lifecycle/disable conditions, and broadcast messages) for downstream integrators.
- Added `AUTO_MODE_INTEGRATION_TEST_NOTES.md` with a client-team integration checklist covering happy-path enable/disable, manual/spectate disable triggers, maintenance policy rejection, reconnect dedupe, TTL expiry validation strategy, and multi-client sanity checks.
- Added `test/auto-mode.smoke.single-client.test.ts` as a focused local runtime smoke test for one client auto-mode lifecycle (enable -> server tick updates target/heartbeat -> disable).
- Added `test/auto-mode.smoke.multi-client.test.ts` for multi-client smoke coverage across collision-area behavior, validating per-client tick updates and obstructed-target fallback during concurrent auto-mode decisions.
- Tuned auto-mode motion cadence/variance in `services/gameloop.service.ts` for more natural movement:
  - Pattern weights adjusted to 58% wander / 24% zigzag / 18% orbit.
  - Decision intervals now vary by pattern (wander: 1100-2600ms, zigzag: 800-1700ms, orbit: 1200-2400ms).
  - Orbit now uses smaller, smoother angle/radius steps (`+0.45..0.9` rad, radius `1.1..2.6`).
  - Zigzag stride/lateral variance reduced to `x: 1.6..4.2`, `y: -1.3..1.3`.
- Updated focused tests to reflect tuned movement parameter ranges (`test/auto-mode.test.ts`, `test/auto-mode.smoke.multi-client.test.ts`).

## Progress notes
- Implemented route + state + fast-loop AI + TTL in source.
- Protocol build succeeded.
- Shard tests succeeded.
- 2026-02-25 sprint chunk: attempted chunk 15 build-memory remediation; collected reproducible OOM failure modes + exit codes.
- 2026-02-25 sprint chunk: completed chunk 16 by adding `test/auto-mode.test.ts` with focused coverage for `toggleAutoMode` enable/disable state transitions and `tickAutoModeClients` 24h expiry cleanup/broadcast.
- 2026-02-25 sprint chunk: completed chunk 17 by adding focused `tickAutoModeClients` tests for (a) out-of-bounds target fallback to `getUnobstructedPosition()` and (b) obstructed target fallback, with deterministic RNG stubs.
- Verified with: `npm test -- test/auto-mode.test.ts` (pass, 5 tests).
- 2026-02-25 sprint chunk: completed chunk 18 by adding reconnect dedupe (`rebindAutoModeSessionByAddress`) and wiring it into login flow to transfer existing auto-mode session state from stale client ids to the reconnecting client id by address.
- Verified with: `npm test -- test/client.service.auto-mode.test.ts test/auto-mode.test.ts` (pass, 10 tests).
- 2026-02-25 sprint chunk: completed chunk 19 by disabling auto-mode session on manual `updateMyself` input, including player-facing broadcast and focused unit test coverage.
- Verified with: `npm test -- test/client.service.auto-mode.test.ts` (pass, 6 tests).
- 2026-02-25 sprint chunk: completed chunk 20 by adding protocol-level router policy tests confirming `toggleAutoMode` is callable by user/guest roles and `maintenance` remains mod-gated.
- Verified with: `cd protocol && npm test -- test/shard.router.auto-mode-policy.test.ts` (pass, 3 tests).
- 2026-02-25 sprint chunk: completed chunk 21 by validating maintenance/spectate transitions and hardening behavior:
  - non-mod clients cannot enable auto mode during maintenance.
  - spectate transition now clears active auto-mode session and emits disable broadcast.
- Verified with: `npm test -- test/client.service.auto-mode.test.ts` (pass, 8 tests).
- 2026-02-25 sprint chunk: completed chunk 22 by adding auto-mode diagnostics counters on shard state and periodic `[AUTO_MODE_DIAGNOSTICS]` logs from fast loop.
  - Added counters for tick volume, decisions, expiries, inactive removals, and fallback target usage.
  - Added focused test coverage for diagnostics counter updates + periodic log emission.
- Verified with: `npm test -- test/auto-mode.test.ts` (pass, 6 tests).
- 2026-02-25 sprint chunk: completed chunk 23 by documenting `toggleAutoMode` API in shard `README.md`, including route name, auth policy, payload shape, lifecycle/TTL semantics, disable triggers, maintenance restriction, cleanup conditions, and user-facing broadcast messages.
- 2026-02-25 sprint chunk: blockers check — no new blockers introduced in this documentation-only chunk; existing full-build OOM blocker remains unchanged.
- 2026-02-26 sprint chunk: completed chunk 24 by adding `AUTO_MODE_INTEGRATION_TEST_NOTES.md` and linking it from `README.md` for client-team end-to-end validation guidance.
- 2026-02-26 sprint chunk: blockers check — no new blockers introduced; existing full-build OOM blocker remains unchanged.
- 2026-02-26 sprint chunk: completed chunk 25 by adding `test/auto-mode.smoke.single-client.test.ts` for a one-client local runtime smoke flow (enable auto mode -> fast-loop tick drives server target/heartbeat -> disable).
- Verified with: `npm test -- test/auto-mode.smoke.single-client.test.ts` (pass, 1 test).
- 2026-02-26 sprint chunk: blockers check — no new blockers introduced in this smoke-test chunk; existing full-build OOM blocker remains unchanged.
- 2026-02-26 sprint chunk: completed chunk 26 by adding `test/auto-mode.smoke.multi-client.test.ts` to validate two concurrent auto-mode clients where one computed target intersects a collision area and correctly falls back to `getUnobstructedPosition()`, while the other continues normal wander targeting.
- Verified with: `npm test -- test/auto-mode.smoke.multi-client.test.ts` (pass, 1 test).
- 2026-02-26 sprint chunk: blockers check — no new blockers introduced in this multi-client smoke chunk; existing full-build OOM blocker remains unchanged.
- 2026-02-26 sprint chunk: completed chunk 27 by tuning auto-mode movement cadence and variance for more natural motion in `tickAutoModeClients`:
  - pattern weighting adjusted (wander/zigzag/orbit = 58/24/18).
  - per-pattern decision delays introduced (wander 1100-2600ms, zigzag 800-1700ms, orbit 1200-2400ms).
  - orbit and zigzag movement amplitude smoothed to reduce abrupt jumps.
- Verified with: `npm test -- test/auto-mode.test.ts test/auto-mode.smoke.multi-client.test.ts` (pass, 7 tests).
- 2026-02-26 sprint chunk: blockers check — no new blockers introduced in this tuning chunk; existing full-build OOM blocker remains unchanged.
- Next chunk target: chunk 28 (tune map collision fallback frequency).
