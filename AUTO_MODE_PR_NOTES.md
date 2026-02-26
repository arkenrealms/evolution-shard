# Auto Mode PR Notes (Branch Hygiene)

## Scope summary
Auto mode now includes:
- toggle route + service wiring + in-memory session state/TTL
- fast-loop AI movement (wander/zigzag/orbit) with boundary/collision safeguards
- reconnect dedupe, manual/spectate/maintenance policy handling
- diagnostics counters/logging + update-throttle protection
- focused unit/smoke coverage + README/integration docs

## Proposed commit split (by concern)
Use this as the cleanup target before opening PRs.

1. **feat(auto-mode): core runtime + policy behavior**
   - `services/core.service.ts`
   - `services/client.service.ts`
   - `services/gameloop.service.ts`
   - `services/auth.service.ts`
   - `shard.service.ts`

2. **test(auto-mode): focused unit + smoke coverage**
   - `test/auto-mode.test.ts`
   - `test/client.service.auto-mode.test.ts`
   - `test/shard.service.auto-mode-disconnect.test.ts`
   - `test/auto-mode.smoke.single-client.test.ts`
   - `test/auto-mode.smoke.multi-client.test.ts`

3. **docs(auto-mode): API + integration + rollout notes**
   - `README.md`
   - `AUTO_MODE_INTEGRATION_TEST_NOTES.md`
   - `AUTO_MODE_PLAN.md`
   - `AUTO_MODE_PR_NOTES.md`

## Branch hygiene status (this sprint)
- Working tree is clean.
- Auto-mode work is isolated to feature-related runtime/test/docs paths.
- Current branch is ahead of remote and contains incremental commits that can be squashed/grouped into the 3 PR-facing commits above.

## Rebase prep (next chunk)
- Interactive rebase from `3b11199` to HEAD.
- Fold progress-only doc commits into a single docs commit.
- Group runtime commits into one feature commit and test commits into one test commit.
- Re-run focused tests after rebase:
  - `npm test -- test/auto-mode.test.ts`
  - `npm test -- test/client.service.auto-mode.test.ts`
  - `npm test -- test/shard.service.auto-mode-disconnect.test.ts`
  - `npm test -- test/auto-mode.smoke.single-client.test.ts`
  - `npm test -- test/auto-mode.smoke.multi-client.test.ts`

## Known blocker
- Full TypeScript build remains memory-constrained on this host (OOM); focused test suites pass.

## PR summary draft (chunk 42)
### What changed
- Added shard `toggleAutoMode` flow end-to-end (protocol router + service typing + shard forwarder/client implementation).
- Added in-memory auto-mode session lifecycle with 24h TTL, disconnect cleanup, reconnect dedupe by address, and manual/spectate disable behavior.
- Added fast-loop server-side AI target selection (wander/zigzag/orbit) with map-boundary clamping, obstruction fallback, fallback cooldown reuse, and anti-cheat position realignment.
- Added maintenance-mode policy enforcement (non-mod enable blocked during maintenance).
- Added diagnostics counters/logging (`[AUTO_MODE_DIAGNOSTICS]`) and player update throttle to reduce queue pressure.
- Added focused unit and smoke tests plus README/integration test documentation.

### Validation runbook
- `npm test -- test/auto-mode.test.ts`
- `npm test -- test/client.service.auto-mode.test.ts`
- `npm test -- test/shard.service.auto-mode-disconnect.test.ts`
- `npm test -- test/auto-mode.smoke.single-client.test.ts`
- `npm test -- test/auto-mode.smoke.multi-client.test.ts`
- `cd ../protocol && npm test -- test/shard.router.auto-mode-policy.test.ts`

### Risk list
1. **Build-surface risk (medium):** full TS build remains OOM on this runner; confidence currently comes from focused tests only.
2. **Runtime load risk (low/medium):** multi-client auto-mode may still raise CPU/log volume under very high concurrency despite update throttle and diagnostics.
3. **Behavior-policy risk (low):** maintenance/spectate/manual disable semantics could differ from product expectation if UX copy/policy changes.
4. **Reconnect edge risk (low):** same-address dedupe keeps longest-lived session by design; verify this matches expected ownership semantics on shared-wallet test setups.
5. **Observability noise risk (low):** periodic diagnostics logs may need tuning if shard log budgets are tight.

## Deploy / rollback handoff notes (chunk 47)
### Pre-deploy checklist
- Confirm protocol and shard branches are pushed and PRs are open/linked.
- Run focused validation suites listed above on the merge candidate SHA.
- Verify shard runtime has memory headroom (full compile OOM on this host is known; runtime should still be observed post-deploy).
- Confirm maintenance policy expectation with product/ops (non-mod users cannot enable auto mode during maintenance).

### Deploy steps (recommended)
1. Deploy protocol package containing `toggleAutoMode` router + service typing.
2. Deploy shard service with auto-mode runtime changes.
3. Smoke check with one client:
   - enable auto mode,
   - observe periodic movement updates and diagnostics,
   - disable auto mode,
   - verify expected broadcast messages.
4. Smoke check with two clients near collider-heavy area; verify no update-flood symptoms in logs.

### Post-deploy observability
- Watch `[AUTO_MODE_DIAGNOSTICS]` every 60s for abnormal spikes in:
  - `fallbackTargets`
  - `skippedPlayerUpdates`
  - `removedInactive`
  - `expired`
- Spot-check support logs for unexpected `Unauthorized` on maintenance toggles.

### Rollback plan
- If severe regression appears, roll back shard deployment to previous stable image/tag.
- If protocol and shard become version-skewed, roll back protocol package to the pre-auto-mode version in lockstep.
- After rollback, verify `toggleAutoMode` is unavailable or safely no-op according to reverted version behavior.

### Operator runbook notes
- Existing auto-mode sessions are in-memory only; shard restart naturally clears sessions.
- During incident response, maintenance mode + restart is a safe kill switch for active auto-mode behavior.
