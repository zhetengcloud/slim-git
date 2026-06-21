# Phase 4 Implementation Plan — Remotes

## Goal

Add remote repository management and the `fetch`, `push`, and `pull` commands to slim-git through a backend-agnostic `Transport` abstraction.

## Packages affected

- `packages/types` — `FetchResult`, `PushResult`, `MergeResult` already added.
- `packages/core` — `Transport` interface, `DiscoveredRef`, `PushCommand`, `PushReport`, and `Repository.fetch`/`push`/`pull`.
- `packages/memory` — `MemoryTransport` for fast, deterministic testing without network or packfiles.
- `packages/http` — Smart HTTP ref discovery and request builders (packfile serialization deferred).

## 1. Transport abstraction

Create `packages/core/src/transport.ts`:

- `Transport` interface with:
  - `name: string`
  - `discoverRefs(): Observable<readonly DiscoveredRef[]>`
  - `fetch(wants, haves): Observable<readonly GitObject[]>`
  - `push(commands, objects): Observable<PushReport>`
- `DiscoveredRef { readonly name: string; readonly oid: Oid }`
- `PushCommand { readonly ref: string; readonly oldOid: Oid; readonly newOid: Oid }`
- `PushReport { readonly accepted: readonly { readonly ref: string; readonly oid: Oid; readonly accepted: boolean }[] }`

The interface intentionally avoids packfiles for now. Concrete transports may implement object-level exchange (`MemoryTransport`) or add packfile encoding later (`SmartHttpTransport`).

## 2. Repository fetch/push/pull

Create `packages/core/src/repository-fetch.ts`:

- `fetch(repo, remoteName, transport, options)` — discovers remote refs, fetches wanted objects, writes them to the local object store, and updates `refs/remotes/<remoteName>/<branch>`.
- `push(repo, remoteName, transport, options)` — resolves the local branch, collects reachable objects, sends them with a push command, and updates the remote-tracking ref.
- `pull(repo, remoteName, transport, options)` — runs `fetch` then `fastForwardMerge` from the remote-tracking ref.
- `FetchOptions { readonly ref?: string }` — defaults to the current branch.

Wire the methods into `Repository` as `fetch`, `push`, and `pull`.

## 3. In-memory transport

Create `packages/memory/src/transport.ts`:

- `MemoryTransport` implements `Transport` by connecting two `StorageBackend` instances directly.
- `fetch` walks commit → tree → blob reachability from the wanted oids.
- `push` writes objects to the remote backend and updates the provided ref map.

Export it from `@slim-git/memory`.

## 4. Smart HTTP transport (foundation)

Create `packages/http`:

- `packages/http/src/pkt-line.ts` — pkt-line encoder/decoder.
- `packages/http/src/smart-http.ts` — `SmartHttpTransport` with ref discovery parsing and request builders for `fetch-pack`/`push-pack`.
- Actual POST handling and packfile serialization are deferred to a later phase.

## 5. Tests

Add focused test files:

- `packages/core/test/repository-fetch.test.ts` — fetch copies objects and writes remote-tracking refs; push updates remote refs; pull fast-forwards the current branch.
- `packages/memory/src/transport.test.ts` — `MemoryTransport` ref discovery, fetch reachability, and push acceptance.

Run `bun test`, `bun tsc --noEmit`, and `bunx oxlint@latest` after changes.
