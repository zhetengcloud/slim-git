# Phase 7 Implementation Plan — Canonical Smart HTTP Transport

## Goal

Make `SmartHttpTransport` in `@slim-git/http` implement the core `Transport` interface so `slim-git` can fetch, push, and pull against real Git servers over Smart HTTP, while keeping the implementation small and reviewable.

## Packages affected

- `packages/http` — packfile encode/decode, delta application, `SmartHttpTransport` fetch/push.
- `packages/core` — extend `Transport` interface with `discoverReceiveRefs()`; update `push` to use it.
- `packages/memory` — implement `discoverReceiveRefs()` in `MemoryTransport`.
- `packages/slim-git` — re-export `@slim-git/http` from the main SDK package.
- `README.md` and `plan.md` — mark Smart HTTP transport complete.

## 1. Packfile format support

Add `packages/http/src/packfile.ts`:

- `buildPackfile(objects)` — build a version 2 packfile from `GitObject[]`.
- `parsePackfile(buffer, hashAlgorithm)` — parse a version 2 packfile and reconstruct objects.
- `applyDelta(delta, base)` — apply Git delta instructions for `OBJ_OFS_DELTA` and `OBJ_REF_DELTA`.

Use `node:zlib` for deflate/inflate and `node:crypto` for the trailing packfile checksum.

## 2. Smart HTTP transport

Update `packages/http/src/smart-http.ts`:

- Make `SmartHttpTransport` implement `Transport`.
- `discoverRefs()` and `discoverReceiveRefs()` via `GET /info/refs?service=...`.
- `fetch()` via `POST /git-upload-pack` with `side-band-64k` and packfile decoding.
- `push()` via `POST /git-receive-pack` with undeltified packfile encoding and report-status parsing.
- Optional constructor options for custom `fetch` implementation and extra headers (auth tokens).

Keep push simple: send full objects, no delta generation, no thin-pack support on the client side.

## 3. Core transport interface

- Add `discoverReceiveRefs(): Observable<readonly DiscoveredRef[]>` to `Transport`.
- Update `repository-fetch.ts` `push()` to discover receive refs for the old oid.
- Update `MemoryTransport` to implement the new method.

## 4. Tests

- Unit tests for packfile round-trip and delta application in `packages/http/test/packfile.test.ts`.
- Update `packages/http/test/smart-http.test.ts` for the new `buildFetchRequest` format.
- Integration tests in `packages/http/test/smart-http-integration.test.ts` using `Bun.serve` to mock `git-upload-pack` and `git-receive-pack` endpoints and verify fetch/push end-to-end.

## 5. Documentation

- Update `README.md` to show `SmartHttpTransport` as implemented and add Phase 7 to the roadmap.
- Update `plan.md` phases to list Smart HTTP transport and move SQL acceleration to Phase 8.

## 6. Verification

Run before each commit:

```bash
bun test
bun tsc --noEmit
bunx oxlint@latest
```
