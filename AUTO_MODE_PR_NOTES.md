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
