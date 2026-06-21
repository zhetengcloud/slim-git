# slim-git — A Slim Git SDK for JavaScript

## 1. Vision

**slim-git** is a lightweight, embeddable Git SDK written in TypeScript for Node.js. It is **SDK-first**, not CLI-first: applications import a programmatic API and work with repository objects directly.

Scope is intentionally narrow. Only the Git operations people use every day are included; advanced or rarely used features are out of scope to keep the codebase small and maintainable.

## 2. Language & Runtime

- **TypeScript** source, compiled to ES2022.
- **Target**: Node.js 18+ only.
- **No native dependencies** by default.
- Optional native acceleration package later for packfile compression.

## 3. SDK-First API Design

The API is object-oriented and promise-based. A repository is opened or initialized as an instance, then callers use methods such as `add`, `commit`, `log`, `status`, `push`, and `merge`.

Core API groups:

- **Lifecycle**: init, open, destroy.
- **Workspace**: status, add, remove, restore.
- **Commits**: commit, amend, log, getCommit.
- **Branches**: list, create, delete, checkout, currentBranch.
- **Tags**: lightweight tags only.
- **Diff**: worktree vs index, index vs HEAD, HEAD vs branch.
- **Merge**: fast-forward only; non-fast-forward merges stop with conflict markers.
- **Remotes**: addRemote, removeRemote, fetch, pull, push.
- **Low-level access**: object store, refs, and index exposed for advanced use.

## 4. Feature Scope (Slim)

### Included

- Repository init/open.
- Staging: `add`, `remove`, `restore`.
- Commit and amend.
- Log/history traversal.
- Branch management and simple checkout.
- Lightweight tags.
- Status (modified, staged, untracked).
- Diff.
- Remotes: fetch, pull, push.
- Fast-forward merge only.
- `.gitignore` support.

### Explicitly Out of Scope

- Rebase, interactive rebase, cherry-pick.
- Submodules, worktrees, subtrees.
- Annotated tags.
- Git hooks (except an optional simple pre-commit callback).
- Subtree merge strategies, octopus merge.
- `gitattributes` beyond basic line-ending handling.
- Packfile v1, `git bundle`.
- Server-side smart HTTP hosting.
- Shallow/partial clones.

## 5. Merge Behavior

Merging is intentionally simple:

1. **Fast-forward only** — if the current branch has not diverged, `merge()` fast-forwards HEAD and updates the working tree.
2. **Non-fast-forward = stop with markers** — if branches have diverged, `merge()` does not resolve automatically. It writes conflict markers to the affected files, leaves the repository in a paused merge state, and reports the conflicted paths.
3. **User resolves** — the user edits the files, stages them with `add()`, and commits to finish the merge.

This removes all automatic merge-resolution strategies while still giving users a clear manual path.

## 6. Architecture

```text
┌────────────────────────────────────┐
│  slim-git SDK (TypeScript API)     │
├────────────────────────────────────┤
│  Commands (init, commit, push, …)  │
├────────────────────────────────────┤
│  Repository Model                  │
│  - refs, index, config, ignore     │
├────────────────────────────────────┤
│  Object Store                      │
│  - loose objects, pack index       │
├────────────────────────────────────┤
│  Storage Backend                   │
│  - Node FS, In-Memory              │
├────────────────────────────────────┤
│  Transport                         │
│  - smart HTTP fetch/push           │
└────────────────────────────────────┘
```

## 7. Storage Backends

The SDK abstracts storage so the same core logic runs on different backends.

- **NodeBackend** — Node.js filesystem. Default for real repositories.
- **MemoryBackend** — In-memory store for unit tests and ephemeral operations.

## 8. Data Model

Compatible with canonical Git’s loose-object model, but simplified:

- **Object types**: blob, tree, commit, tag.
- **Hash**: SHA-1 by default; SHA-256 opt-in.
- **Refs**: HEAD, refs/heads/_, refs/tags/_, refs/remotes/\*.
- **Index**: v2 format minimum.
- **Config**: minimal `.git/config` parser.

Packfiles are read and written lazily. Loose objects are the default for simplicity.

## 9. Implementation Phases

### Phase 0 — Core Object Model

- Repository init/open.
- Object read/write.
- Node FS and in-memory backends.

### Phase 1 — Staging & Commit

- Index read/write.
- `status`, `add`, `remove`, `restore`.
- `commit` and amend.

### Phase 2 — History & Branches

- `log` with async iteration.
- Branch CRUD and `checkout`.
- Lightweight tags.

### Phase 3 — Diff

- Worktree vs index, index vs HEAD, HEAD vs branch diff.
- Basic line-level diff.

### Phase 4 — Remotes

- Remote management.
- Smart HTTP fetch/push.
- `pull` as fetch + fast-forward merge.

### Phase 5 — Merge

- Fast-forward merge.
- Detect non-fast-forward merges, write conflict markers, and stop.
- `.gitignore` support.

### Phase 6 — Polish

- TypeScript types and documentation.
- Canonical Git round-trip tests.

### Phase 7 — Smart HTTP Transport

- Packfile encoder/decoder with delta support.
- `SmartHttpTransport` implementing the core `Transport` interface.
- Fetch and push against real Git servers (GitHub, GitLab, self-hosted).
- `side-band-64k` response parsing and report-status handling.

### Phase 8 — Node Filesystem Backend

- Loose-object storage on disk (`@slim-git/fs`).
- Ref, index, workspace, and config persistence.
- `initNodeRepository(path)` and `openNodeRepository(path)` factories.
- Integration tests round-tripping with canonical Git.

## 10. Package Layout (Monorepo)

```text
packages/
├── slim-git            # Main SDK
├── @slim-git/core      # Object store, refs, index, config
├── @slim-git/fs        # Node FS backend
├── @slim-git/memory    # In-memory backend
├── @slim-git/http      # Smart HTTP transport
└── @slim-git/types     # Shared TypeScript types
```

## 11. Testing Strategy

- Unit tests using the memory backend.
- Integration tests round-tripping with canonical Git for the supported subset.
- Property tests for content-addressing and index consistency.
- Benchmarks for `status`, `log`, and `diff` on small/medium repos.

## 12. Compatibility

slim-git is not a full Git replacement. It targets the 80% use case:

- Can read repos created by canonical Git.
- Can create repos readable by canonical Git for supported operations.
- Fails explicitly with a clear error when an unsupported operation is requested.

## 13. Example Use Case

Typical usage in a Node.js script or VS Code extension:

```ts
const repo = await openRepository(workspaceFolder);
const status = await repo.status();

if (status.staged.length > 0) {
  await repo.commit({
    message: `Auto-commit ${status.staged.length} files`,
    author: { name: "Extension", email: "ext@example.com" },
  });
  await repo.push("origin", await repo.getCurrentBranch());
}
```

This is the sweet spot for Node.js: scriptable, no CLI parsing, no subprocess overhead.
