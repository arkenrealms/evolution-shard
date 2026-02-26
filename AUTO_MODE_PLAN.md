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
17. [ ] Add focused tests for AI target validity (boundary + unobstructed fallback).
18. [ ] Add safeguard for duplicate sessions by address reconnect handling.
19. [ ] Consider optional policy: auto mode disabled on manual `updateMyself` (if desired).
20. [ ] Verify role/policy expectations (user-level vs mod-level route use).
21. [ ] Validate behavior under maintenance mode and spectate transitions.
22. [ ] Add logging counters/diagnostics for auto ticks and expiry events.
23. [ ] Document API in shard README (route + expected payload).
24. [ ] Create integration test notes for client team.
25. [ ] Smoke test in local shard runtime with one auto client.
26. [ ] Smoke test with multiple clients + collision areas.
27. [ ] Tune pattern intervals and movement variance for natural motion.
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
- Git commit is currently blocked by missing repo/user identity config (`user.name` / `user.email`).
- Next chunk should try a higher-memory node/runner or an incremental/project-reference build split that avoids monolithic `tsc` heap spikes.

## Progress notes
- Implemented route + state + fast-loop AI + TTL in source.
- Protocol build succeeded.
- Shard tests succeeded.
- 2026-02-25 sprint chunk: attempted chunk 15 build-memory remediation; collected reproducible OOM failure modes + exit codes.
- 2026-02-25 sprint chunk: completed chunk 16 by adding `test/auto-mode.test.ts` with focused coverage for `toggleAutoMode` enable/disable state transitions and `tickAutoModeClients` 24h expiry cleanup/broadcast.
- Next chunk target: chunk 17 (AI target validity tests for boundary + unobstructed fallback).
