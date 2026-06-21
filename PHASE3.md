# Phase 3 Implementation Plan — Diff

## Goal

Add line-level diff support to slim-git so callers can compare the worktree, index, HEAD, and arbitrary refs or branches.

## Packages affected

- `packages/types` — new `Diff`, `FileDiff`, `Hunk`, and `DiffLine` types.
- `packages/core` — Myers diff algorithm, unified-diff hunk formatting, and repository diff methods.
- `packages/slim-git` — re-export new public APIs.

## 1. Types

Add to `@slim-git/types`:

- `Diff { readonly files: readonly FileDiff[] }`
- `FileDiff { readonly path: string; readonly status: "added" | "deleted" | "modified" | "renamed" | "unchanged"; readonly oldPath?: string; readonly hunks: readonly Hunk[] }`
- `Hunk { readonly oldStart: number; readonly oldLines: number; readonly newStart: number; readonly newLines: number; readonly lines: readonly DiffLine[] }`
- `DiffLine { readonly type: "context" | "added" | "removed"; readonly text: string }`

## 2. Diff algorithm

Create `packages/core/src/diff.ts`:

- `myersDiff(oldLines, newLines): Edit[]` — computes the shortest edit script using Myers' O(ND) algorithm.
- `createHunks(edits, oldLines, newLines, contextLines): Hunk[]` — groups edits into unified-diff hunks with surrounding context.
- `unifiedDiff(oldContent, newContent, contextLines): Hunk[]` — decodes two byte arrays, diffs them, and returns hunks.

Implementation notes:

- Keep the algorithm pure and split into small helpers (`buildForwardTrace`, `reconstructEdits`, `walkMatches`, diagonal-array accessors).
- Preserve trailing newlines by splitting lines with the newline as part of the line content.

## 3. Repository diff methods

Add to `Repository`:

- `diffWorktreeIndex(): Observable<Diff>` — compares the working tree against the index.
- `diffIndexHead(): Observable<Diff>` — compares the index against HEAD.
- `diffHeadRef(ref): Observable<Diff>` — compares HEAD against a branch, tag, or oid.

Internal helpers:

- `resolveTreeMap$(source)` — flattens "worktree", "index", "head", or any ref/branch/oid into a path → `{ oid, mode }` map.
- `diffTreeMaps$(oldMap, newMap)` — emits one `FileDiff` per path, using `unifiedDiff` for modified files.

## 4. Tests

Add focused test files:

- `packages/core/test/diff.test.ts` — unit tests for `myersDiff`, `createHunks`, and `unifiedDiff`.
- `packages/core/test/repository-diff.test.ts` — integration tests for `diffWorktreeIndex`, `diffIndexHead`, and `diffHeadRef`.

Cover:

- Empty inputs, all inserts, all deletes, identical inputs.
- Single insert/delete/replace and multiple changes.
- Hunk grouping, context lines, and adjacent change merging.
- Added/deleted/modified files at the repository level.
- Diff context lines around changes.

## 5. Style & constraints

- Bun, TypeScript strict, oxfmt/oxlint.
- RxJS for async orchestration.
- Pure functions for the diff algorithm; small focused helpers.
- SOLID: separate algorithm, formatting, and repository orchestration concerns.
