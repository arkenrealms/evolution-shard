# arken/packages/evolution/packages/shard

Shard server package for Arken Evolution Isles.

## Current maintenance status
- Rotation slot: **9** (`evolution-shard`)
- Branch hygiene: synced with `origin/main` before edits.
- Source-change gate: **active** (source edits validated by runnable tests in-run).

## Latest reliability fixes (2026-02-19)
- `Service.handleClientMessage` now validates decoded payload shape before destructuring, avoiding pre-`try` crashes.
- Client emit dispatch now checks method callability, trims accidental method-name whitespace, and preserves explicit falsy `params` (for example `false`).
- tRPC response emission is now socket-safe: when `socket.emit` is unavailable, success/error paths no-op instead of throwing inside error handling.
- Malformed string payloads (`decodePayload` parse failures) are now caught inside handler error flow instead of escaping before response/error accounting.
- Error handling tolerates missing/non-object `socket.shardClient` and normalizes bad `log.errors` counters.
- `Service.handleClientMessage` now rejects prototype-only emit methods (own-property check), preventing accidental inherited dispatch.
- `Service.onPlayerUpdates` now returns an explicit success envelope (`{ status: 1 }`).

## Test harness status
- Added package-level `test` script so `rushx test` is available.
- Added local Jest config (`jest.config.cjs`) for TypeScript unit tests in `test/*.test.ts`.
