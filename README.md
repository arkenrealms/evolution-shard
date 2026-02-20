# arken/packages/evolution/packages/shard

Shard server package for Arken Evolution Isles.

## Current maintenance status
- Rotation slot: **9** (`evolution-shard`)
- Branch hygiene: synced with `origin/main` before edits.
- Source-change gate: **active** (source edits validated by runnable tests in-run).

## Latest reliability fixes (2026-02-19)
- `Service.handleClientMessage` now validates decoded payload shape before destructuring, avoiding pre-`try` crashes.
- Client emit dispatch now checks method callability and preserves explicit falsy `params` (for example `false`).
- Error handling tolerates missing/non-object `socket.shardClient` and normalizes bad `log.errors` counters.
- `Service.onPlayerUpdates` now returns an explicit success envelope (`{ status: 1 }`).

## Test harness status
- Added package-level `test` script so `rushx test` is available.
- Added local Jest config (`jest.config.cjs`) for TypeScript unit tests in `test/*.test.ts`.
