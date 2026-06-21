# slim-git

A lightweight, embeddable **Git SDK** written in TypeScript for Node.js 18+. It is **SDK-first**, not CLI-first: applications import a programmatic API and work with repository objects directly.

## What slim-git is not

slim-git is intentionally small. It is **not** a full Git replacement, a command-line interface, or a tool for advanced workflows like interactive rebase, submodules, or signed commits. It targets the common subset of Git operations needed by embedded tools, tests, and lightweight applications. We chose this scope to keep the API simple, the dependency tree minimal, and the core easy to reason about.

## Packages

This repository is a Bun workspace monorepo:

```text
packages/
├── slim-git          # Main SDK entry point
├── @slim-git/core    # Object store, refs, index, config, repository
├── @slim-git/memory  # In-memory storage backend
└── @slim-git/types   # Shared TypeScript types and errors
```

## Installation

```bash
bun install
```

## Quick start

```ts
import { lastValueFrom } from "rxjs";
import { createMemoryRepository } from "slim-git";

const repo = await lastValueFrom(createMemoryRepository());

// Write a file, stage it, and commit it
await lastValueFrom(
  repo.workspace.writeFile("hello.txt", new TextEncoder().encode("Hello, slim-git!")),
);
await lastValueFrom(repo.add(["hello.txt"]));

const oid = await lastValueFrom(
  repo.commit({
    message: "Initial commit",
    author: {
      name: "Developer",
      email: "dev@example.com",
      timestamp: new Date(),
      timezoneOffsetMinutes: 0,
    },
  }),
);

console.log("Created commit:", oid);
```

## Supported operations

- Repository lifecycle: `init`, `open`
- Object storage: blob/tree/commit read/write with SHA-1 or SHA-256
- Staging: `add`, `remove`, `restore`
- Commits: `commit`, `amend`
- Status: modified, staged, deleted, and untracked files
- History: `log`
- Branches: `createBranch`, `listBranches`, `deleteBranch`, `getCurrentBranch`
- Tags: `createTag`, `listTags`, `deleteTag`
- Workspace switching: `checkout`
- Diff: `diffWorktreeIndex`, `diffIndexHead`, `diffHeadRef`

## Scripts

```bash
bun test          # run all tests
bun run typecheck # TypeScript type check
bun run lint      # run oxlint
bun run fmt       # format with oxfmt
bun run fmt:check # check formatting
```

## Architecture

```text
┌────────────────────────────────────┐
│  slim-git SDK (TypeScript API)     │
├────────────────────────────────────┤
│  Repository                        │
│  - status, add, commit, amend …    │
│  - log, branches, tags, checkout   │
├────────────────────────────────────┤
│  Object Store + Ref/Index Stores   │
├────────────────────────────────────┤
│  Storage Backend                   │
│  - MemoryBackend (today)           │
│  - NodeBackend (planned)           │
└────────────────────────────────────┘
```

## Roadmap

Phases follow [`plan.md`](./plan.md):

- [x] Phase 0 — Core object model (memory backend)
- [x] Phase 1 — Staging & commit
- [x] Phase 2 — History & branches
- [x] Phase 3 — Diff
- [ ] Phase 4 — Remotes (smart HTTP fetch/push)
- [ ] Phase 5 — Merge (fast-forward + conflict markers)
- [ ] Phase 6 — Polish, docs, benchmarks
- [ ] Phase 7 — Optional TypeORM SQL acceleration

## Design principles

- **SDK-first**: import an API, not a CLI.
- **Storage-agnostic**: same core logic on memory, filesystem, or SQL backends.
- **Minimal dependencies**: Bun, TypeScript, and RxJS for reactive logic.
- **Explicit errors**: typed errors such as `NotFoundError`, `ConflictError`, and `UnsupportedError`.

## License

MIT
