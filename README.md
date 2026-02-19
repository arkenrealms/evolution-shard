# arken/packages/evolution/packages/shard

Shard server package for Arken Evolution Isles.

## Current maintenance status
- Rotation slot: **8** in current flattened rotation (`arken/evolution/shard`).
- Branch hygiene: fetched `origin/main` and continued from a fresh branch.
- Source-change gate: **active** (all source edits validated with runnable tests).

## Test harness status
- Added package-level `test` script so `rushx test` works in this direct repo.
- Added local Jest config for TypeScript unit tests (`*.unit.test.ts`).

## Latest reliability fixes (2026-02-19)
- `Service.onPlayerUpdates` now returns an explicit success envelope (`{ status: 1 }`) instead of `undefined`.
- `Service.handleClientMessage` now guards malformed payloads and missing method names, returning structured tRPC errors.
- Error catch path now safely handles missing/non-object `socket.shardClient` and non-numeric `log.errors` without cascading failures.
- Added regression tests for invalid payloads, invalid methods, and missing `shardClient` error-path behavior.
