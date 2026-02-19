# arken/packages/evolution/packages/shard

Shard server package for Arken Evolution Isles.

## Current maintenance status
- Rotation slot: **9** (`evolution-shard`)
- Branch hygiene: synced with `origin/main` before analysis.
- Source-change gate: **active** (no source edits without runnable tests in-run).

## Test harness status
- Added package-level Jest test script (`test`) so `rushx test` now resolves in this repo.
- Added local `jest.config.js` with `ts-jest` + Node environment for `.test.ts` files.

## This run's reliability fixes
- `Service.onPlayerUpdates` returns an explicit `{ status: 1 }` envelope instead of implicitly returning `undefined`.
- `Service.handleClientMessage` now gracefully handles malformed payloads and missing method names by returning structured error envelopes instead of throwing pre-handler exceptions.
- Added regression tests to lock both behavior contracts.

## Latest maintenance chunk (2026-02-19)
- Hardened `Service.handleClientMessage` catch-path behavior when `socket.shardClient` or `socket.shardClient.log.errors` is missing.
- Runtime exceptions now still emit a tRPC error envelope instead of failing inside the error handler.
- Added tests for:
  - missing `shardClient` during runtime exception,
  - missing/non-numeric `shardClient.log.errors` initialization.
