# Phase 4 Implementation Plan — Remotes

## Goal

Add remote repository support to slim-git: manage remotes, fetch from and push to them over Smart HTTP, and implement `pull` as fetch plus a fast-forward merge.

## Packages affected

- `packages/types` — `Remote`, `FetchResult`, `PushResult`, `PullResult`, and `MergeResult` types.
- `packages/core` — config handling for remotes, `Repository` remote methods, fast-forward merge.
- `packages/http` — Smart HTTP transport (`upload-pack` / `receive-pack` protocol).
- `packages/memory` — optional in-memory HTTP transport shim for tests.
- `packages/slim-git` — re-export new public APIs.

## 1. Configuration and remote management

Add minimal `.git/config` support:

- `Config` interface in `@slim-git/core`:
  - `get(section, key): string | undefined`
  - `set(section, key, value): void`
  - `remove(section, key): void`
  - `list(section): [key, value][]`
- Backed by the storage backend (initially in-memory; later persisted by Node FS backend).

Add to `Repository`:

- `addRemote(name, url): Observable<Remote>` — stores `remote.<name>.url` in config.
- `removeRemote(name): Observable<void>` — removes `remote.<name>.*` entries.
- `listRemotes(): Observable<Remote[]>` — returns `{ name, url }` sorted by name.

## 2. Fast-forward merge

Implement a focused fast-forward merge helper used by `pull`:

- `fastForwardMerge(target: string): Observable<MergeResult>`
  - Resolve `target` to a commit oid.
  - Verify HEAD is an ancestor of `target` (no divergence).
  - Move HEAD (and the current branch if not detached) to `target`.
  - Update the index and working tree to the target tree.
- Result type: `{ merged: true; commitOid: Oid }` or an explicit error.

Non-fast-forward merges (conflict markers, paused merge state) remain out of scope and will be handled in Phase 5.

## 3. Smart HTTP transport

Create `packages/http`:

- `SmartHttpTransport` interface or class with:
  - `discoverRefs(url, service): Observable<RefDiscovery>` — performs `GET /info/refs?service=<service>`.
  - `fetchPack(url, wants, haves): Observable<Uint8Array>` — POST to `/git-upload-pack`, returns packfile bytes.
  - `pushPack(url, commands, packfile): Observable<PushReport>` — POST to `/git-receive-pack`.
- Use the Git "pkt-line" format for request/response framing.
- Implement side-band detection for progress/error streams.

Out of scope for this phase: dumb HTTP, SSH, local protocol, proxy support, and packfile indexing (keep fetched objects as loose objects).

## 4. Repository fetch/push/pull

Add to `Repository`:

- `fetch(remoteName, options?): Observable<FetchResult>`
  - Discover refs from the remote.
  - Download missing objects via `fetchPack`.
  - Update `refs/remotes/<remote>/<ref>` refs in the local ref store.
  - Return fetched branch/tag refs.
- `push(remoteName, refspec?): Observable<PushResult>`
  - Resolve local ref to oid.
  - Discover remote refs, compute required objects, build a packfile.
  - Send update commands and packfile via `pushPack`.
  - Report accepted/rejected updates.
- `pull(remoteName, refspec?): Observable<PullResult>`
  - Fetch from remote.
  - Fast-forward merge the current branch to the fetched ref.

## 5. Packfile helpers (minimal)

In `@slim-git/core`:

- `PackfileBuilder` — builds a thin or full packfile from a list of objects.
- `PackfileParser` — parses a fetched packfile and writes loose objects into the object store.

For Phase 4, keep these minimal and synchronous where possible; full pack index and delta resolution optimization comes later.

## 6. Tests

Add focused test files:

- `packages/core/test/config.test.ts` — config get/set/remove/list.
- `packages/core/test/repository-remotes.test.ts` — addRemote, removeRemote, listRemotes.
- `packages/core/test/fast-forward-merge.test.ts` — fast-forward merge scenarios.
- `packages/http/test/smart-http.test.ts` — pkt-line parsing, ref discovery request formatting.
- `packages/core/test/repository-fetch.test.ts` and `repository-push.test.ts` — integration tests using a local HTTP test server or transport stub.

## 7. Style & constraints

- Bun, TypeScript strict, oxfmt/oxlint.
- RxJS for async orchestration.
- Keep the transport protocol isolated in `packages/http`; do not leak HTTP-specific code into `@slim-git/core`.
- Pure functions for packfile/pkt-line formatting.
- SOLID: small focused functions, dependency injection, interface segregation.
