# arken/packages/evolution/packages/shard

Shard server package for Arken Evolution Isles.

## Current maintenance status
- Rotation slot: **9** (`evolution-shard`)
- Branch hygiene: synced with `origin/main` before edits.
- Source-change gate: **active** (source edits validated by runnable tests in-run).

## Latest reliability fixes (2026-02-20)
- `Service.handleClientMessage` now validates decoded payload shape before destructuring, avoiding pre-`try` crashes.
- Result logging now uses normalized method names, so loggable-event telemetry still records method results when client method names include accidental surrounding whitespace.
- Client emit dispatch now checks method callability, trims accidental method-name whitespace, and preserves explicit falsy `params` (for example `false`).
- tRPC response emission is socket-safe for both missing and throwing emitters: if `socket.emit` is unavailable it no-ops, and if `socket.emit` throws it is contained/logged instead of cascading into new handler errors.
- Method dispatch no longer depends on `loggableEvents` always being initialized; missing/non-array logger config now safely skips optional method-result logging instead of breaking dispatch.
- Loggable-event tracing now safely handles circular/unserializable `params` payloads, so diagnostics cannot crash valid client dispatch paths.
- Blank/whitespace-only string payloads are rejected before decode, preventing noisy JSON parse attempts while still returning normalized tRPC errors.
- Non-JSON string payloads (for example plain text) are now rejected before decode so invalid chatter cannot trigger avoidable parse attempts/log spam.
- Valid JSON string payloads are parsed directly and dispatched correctly (without binary-decoder side effects), preserving normal tRPC response semantics for string transport clients.
- Buffer/Uint8Array JSON payloads are normalized to UTF-8 before parse, so binary-frame client transports are handled consistently.
- ArrayBuffer/DataView JSON payloads are also normalized to UTF-8 before parse, preventing false "Invalid trpc method" errors when socket transports surface binary views.
- Malformed JSON string payloads are now caught inside handler error flow instead of escaping before response/error accounting.
- JSON array envelopes are now rejected as invalid payloads so list-shaped messages cannot fall through into misleading "Invalid trpc method" errors.
- Error handling tolerates missing/non-object `socket.shardClient` and normalizes bad `log.errors` counters.
- Error-path accounting now safely tolerates non-object `socket.shardClient.log` values (for example string corruption), preserving normalized error responses instead of throwing while incrementing counters.
- `Service.handleClientMessage` now rejects prototype-only emit methods (own-property check), preventing accidental inherited dispatch.
- `Service.onPlayerUpdates` now returns an explicit success envelope (`{ status: 1 }`).

## Test harness status
- Added package-level `test` script so `rushx test` is available.
- Added local Jest config (`jest.config.cjs`) for TypeScript unit tests in `test/*.test.ts`.
