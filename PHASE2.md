# Phase 2 Implementation Plan — History, Branches, and Tags

## Goal

Extend slim-git with history traversal, branch management, checkout, and lightweight tags, all backed by the in-memory backend.

## Packages affected

- `packages/types` — new `Branch`, `Tag`, and `Head` types; `RefStore` deletion support.
- `packages/core` — commit parser, `log` async iterator, branch CRUD, checkout, tag CRUD.
- `packages/memory` — `delete()` support in `MemoryRefStore`.
- `packages/slim-git` — re-export new public APIs.

## 1. Types

Add to `@slim-git/types`:

- `Branch { readonly name: string; readonly target: Oid }`
- `Tag { readonly name: string; readonly target: Oid }`
- `Head { readonly type: "detached" | "branch"; readonly target: string }` (target is oid or ref name)

Add to `RefStore` interface in `@slim-git/core`:

- `delete(ref: string): Promise<void>`

## 2. Commit parser

Create `packages/core/src/commit-parser.ts`:

- `parseCommit(object: GitObject): CommitInfo` — parses canonical commit bytes into `CommitInfo`.
- Reuses the parsing logic currently inlined in `Repository`.

## 3. `Repository.log()`

Add `Repository.log(options?: LogOptions): Observable<CommitInfo>`.

- Default start point is HEAD.
- Accepts an optional `ref` option to start from a branch or commit oid.
- Uses RxJS `expand` to walk parents breadth-first, `distinct` to avoid revisiting oids, and `map` with `parseCommit`.
- Consumers can subscribe, take a limited number of commits, or apply additional RxJS operators.

## 4. Branch CRUD

Add to `Repository`:

- `createBranch(name, options?: { target?: string }): Promise<void>` — writes `refs/heads/<name>`.
  - Throws `ConflictError` if the branch already exists.
  - Default target is HEAD; throws if HEAD does not exist.
- `listBranches(): Promise<Branch[]>` — lists `refs/heads/*`, sorted by name.
- `deleteBranch(name): Promise<void>` — deletes `refs/heads/<name>`.
  - Throws `UnsupportedError` if trying to delete the current branch.
- `getCurrentBranch(): Promise<string | undefined>` — returns the branch name if HEAD is symbolic, otherwise undefined.

## 5. Checkout

Add `Repository.checkout(target: string): Promise<void>`.

- If `target` matches a branch name, update HEAD to `ref: refs/heads/<target>` and use that branch's target.
- If `target` is a commit oid, detach HEAD to that oid.
- Write the target tree into the workspace and index.
- Clear any paths in the workspace that are not in the target tree.

## 6. Lightweight tags

Add to `Repository`:

- `createTag(name, options?: { target?: string }): Promise<void>` — writes `refs/tags/<name>`.
  - Throws `ConflictError` if the tag already exists.
  - Default target is HEAD.
- `listTags(): Promise<Tag[]>` — lists `refs/tags/*`, sorted by name.
- `deleteTag(name): Promise<void>` — deletes `refs/tags/<name>`.

## 7. Memory backend updates

`MemoryRefStore` gains `delete(ref)`.

## 8. Tests

Add `packages/core/test/phase2.test.ts` covering:

- `log()` walks commits from HEAD.
- `log({ ref: branchName })` walks from a branch.
- `createBranch` / `listBranches` / `deleteBranch`.
- `getCurrentBranch` returns the symbolic branch name.
- `checkout` switches branch and updates workspace/index.
- `checkout` with an oid detaches HEAD.
- `createTag` / `listTags` / `deleteTag`.

## 9. Style & constraints

- Bun, TypeScript strict, oxfmt/oxlint.
- Declarative array operations; async generators for `log`.
- SOLID: keep parsing, ref operations, and checkout logic focused.
