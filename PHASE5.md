# Phase 5 Implementation Plan — Merge & .gitignore

## Goal

Complete non-fast-forward merge support and add `.gitignore` handling so slim-git can perform real three-way merges and ignore untracked files.

## Packages affected

- `packages/types` — extend `MergeResult` to a discriminated union and add `MergeConflict`.
- `packages/core` — merge-base finder, three-way tree merge, conflict markers, `Repository.merge`, and `.gitignore` parsing/integration.

## 1. Merge result types

Change `MergeResult` from a single success interface to a discriminated union:

```ts
export interface MergeSuccessResult {
  readonly merged: true;
  readonly commitOid: Oid;
}

export interface MergeConflict {
  readonly path: string;
  readonly content: Uint8Array;
}

export type MergeResult =
  | MergeSuccessResult
  | { readonly merged: false; readonly conflicts: readonly MergeConflict[] };
```

Update callers (e.g., `pull`) to handle both shapes.

## 2. Merge-base finder

Create `packages/core/src/merge-base.ts`:

- `findMergeBase$(repo, a, b)` returns the best common ancestor of two commits.
- Collect all ancestors of `a`, then breadth-first walk from `b` and return the first match.

## 3. Three-way tree merge

Create `packages/core/src/tree-merge.ts`:

- `mergeTrees$(store, baseTree, headTree, targetTree, targetLabel)` flattens all three trees, compares each path, and decides:
  - unchanged on one side → take the other side's change;
  - both changed identically → take the shared result;
  - both changed differently → write conflict-marker content (`<<<<<<< HEAD ... ======= ... >>>>>>> <label>`) and record a conflict.
- Returns the merged tree oid and any conflicts.

## 4. Repository.merge

Extend `packages/core/src/repository-merge.ts`:

- `merge(repo, target, options)` first attempts a fast-forward.
- If that fails, it finds the merge base, performs a three-way tree merge, applies the resulting tree to the workspace and index, and either:
  - returns `{ merged: false, conflicts }` when there are conflicts (HEAD does not move), or
  - creates a merge commit with two parents, moves HEAD, and returns `{ merged: true, commitOid }`.

Add `Repository.merge(target, options)` and keep `Repository.fastForwardMerge` for backward compatibility.

## 5. .gitignore support

Create `packages/core/src/gitignore.ts`:

- `parseGitignore(content)` turns raw `.gitignore` text into ordered rules.
- `isIgnored(path, patterns)` evaluates rules with support for:
  - glob patterns (`*.log`);
  - directory-only rules (`node_modules/`);
  - anchored rules (`/build`, `foo/bar`);
  - negation (`!important.log`).

Integrate into `Repository.status` and `Repository.add`:

- `status` filters ignored files out of `untracked`.
- `add` skips ignored paths and reports only the paths that were actually staged.

## 6. Tests

Add focused test files:

- `packages/core/test/merge-base.test.ts`
- `packages/core/test/repository-merge-three-way.test.ts`
- `packages/core/test/gitignore.test.ts`
- `packages/core/test/repository-gitignore.test.ts`

Cover clean merges, conflict markers, fast-forward via `merge`, merge-base identity/divergence/linear history, and `.gitignore` parsing/status/add behavior.
