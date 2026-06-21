# Phase 6 Implementation Plan — Polish

## Goal

Polish the SDK's public surface: improve TypeScript types, add consistent TSDoc documentation, and harden the test suite. Benchmarks against canonical Git are intentionally out of scope for this small project.

## Packages affected

- `packages/types` — add/complete TSDoc for all exported types and errors.
- `packages/core` — add TSDoc to public classes, interfaces, functions, and utility modules.
- `packages/memory` — document public memory backends and `MemoryTransport`.
- `packages/http` — document pkt-line and Smart HTTP transport public API.
- `packages/slim-git` — ensure SDK entry point is fully documented.

## 1. Public API documentation

Audit every public export and add TSDoc comments where missing:

- Types in `@slim-git/types` (`IndexEntry`, `Status`, `Diff`, `MergeResult`, etc.).
- Core classes (`Repository`, `ObjectStore`, `Index`, `CommitBuilder`, `TreeBuilder`).
- Core interfaces (`StorageBackend`, `RefStore`, `IndexStore`, `WorkspaceBackend`, `Config`, `Transport`).
- Memory backends and `MemoryTransport`.
- HTTP transport public exports.

Follow the project convention: explain *why* and *what*, keep comments concise, and document all parameters and return types.

## 2. TypeScript type consistency

- Ensure `Oid` branded type is used consistently across public APIs.
- Replace remaining `string` casts with proper `Oid` branding where appropriate.
- Review `Observable<unknown>` usages and tighten return types.
- Ensure discriminated unions (`MergeResult`) are exported and consumed correctly.

## 3. Integration tests against canonical git

Where it adds value and does not require a filesystem backend, add tests that round-trip data through the canonical `git` CLI:

- Verify object hashes match canonical Git.
- Verify tree and commit serialization formats.
- Verify diff output format is compatible with unified diff.

Keep these tests optional/skippable if `git` is not installed.

## 4. Final documentation

- Update `README.md` if any public API changed.
- Ensure `PHASE6.md` accurately reflects the completed work.
- Run `bun test`, `bun tsc --noEmit`, `bunx oxlint@latest`, and `bun run fmt` before each commit.
