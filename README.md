# arken/packages/evolution/packages/shard

Shard server package for Arken Evolution Isles.

## Current maintenance status
- Rotation slot: **8** in flattened rotation (`arken/evolution/shard`).
- Branch hygiene: fetched and integrated `origin/main` before source edits.
- Source-change gate: **active** (all source edits validated with runnable tests in-run).

## Test harness status
- Added a package-level `test` script so `rushx test` works in this direct repo.
- Added local Jest config for TypeScript unit tests (`*.unit.test.ts`).

## Latest reliability fixes (2026-02-19)
- `Service.onPlayerUpdates` now returns an explicit success envelope (`{ status: 1 }`) instead of `undefined`.
- `Service.handleClientMessage` now guards malformed payloads and missing method names, returning structured tRPC errors.
- Error catch path now safely handles missing/non-object `socket.shardClient` and non-numeric `log.errors` without cascading failures.
- Added regression tests for invalid payloads, invalid methods, missing `shardClient` error-path behavior, and `onPlayerUpdates` return contract.
