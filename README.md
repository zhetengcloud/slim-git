# slim-git

A lightweight, embeddable **Git SDK** written in TypeScript for Node.js 18+. It is **SDK-first**, not CLI-first: applications import a programmatic API and work with repository objects directly.

## What slim-git is not

slim-git is intentionally small. It is **not** a full Git replacement, a command-line interface, or a tool for advanced workflows like interactive rebase, submodules, or signed commits. It targets the common subset of Git operations needed by embedded tools, tests, and lightweight applications. We chose this scope to keep the API simple, the dependency tree minimal, and the core easy to reason about.

## Packages

This repository is a Bun workspace monorepo:

```text
packages/
├── slim-git          # Main SDK entry point
├── @slim-git/core    # Object store, refs, index, config, repository, merge
├── @slim-git/fs      # Node.js filesystem backend
├── @slim-git/memory  # In-memory storage backend and transport
├── @slim-git/http    # Smart HTTP transport foundation (ref discovery, pkt-line)
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

## Node filesystem backend

For real repositories on disk, use `initNodeRepository` or `openNodeRepository` from `slim-git`:

```ts
import { lastValueFrom } from "rxjs";
import { initNodeRepository } from "slim-git";

const repo = await lastValueFrom(initNodeRepository("./my-repo"));

await lastValueFrom(
  repo.workspace.writeFile("hello.txt", new TextEncoder().encode("Hello from Node FS!")),
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

The Node backend stores objects, refs, index, and config in the standard `.git` layout, so the repository is also readable by canonical Git.

## Supported operations

- Repository lifecycle: `init`, `open`
- Object storage: blob/tree/commit read/write with SHA-1 or SHA-256
- Staging: `add`, `remove`, `restore`
- Commits: `commit`, `amend`
- Status: modified, staged, deleted, untracked files, and `.gitignore` filtering
- History: `log`
- Branches: `createBranch`, `listBranches`, `deleteBranch`, `getCurrentBranch`
- Tags: `createTag`, `listTags`, `deleteTag`
- Workspace switching: `checkout`
- Diff: `diffWorktreeIndex`, `diffIndexHead`, `diffHeadRef`
- Merge: `fastForwardMerge`, `merge` (three-way with conflict markers)
- Remotes: `addRemote`, `removeRemote`, `listRemotes`
- Transport: `fetch`, `push`, `pull` via the `Transport` abstraction

## Scripts

```bash
bun test          # run all tests
bun run typecheck # TypeScript type check
bun run lint      # run oxlint
bun run fmt       # format with oxfmt
bun run fmt:check # check formatting
```

Optional round-trip tests against canonical `git` are skipped automatically when `git` is not installed.

## Architecture

```text
┌────────────────────────────────────┐
│  slim-git SDK (TypeScript API)     │
├────────────────────────────────────┤
│  Repository                        │
│  - status, add, commit, amend …    │
│  - log, branches, tags, checkout   │
│  - diff, merge, remotes, fetch…    │
├────────────────────────────────────┤
│  Object Store + Ref/Index Stores   │
├────────────────────────────────────┤
│  Storage Backend                   │
│  - MemoryBackend (testing)         │
│  - NodeBackend (today)             │
├────────────────────────────────────┤
│  Transport                         │
│  - MemoryTransport (testing)       │
│  - SmartHttpTransport (today)      │
└────────────────────────────────────┘
```

## Roadmap

Phases follow [`plan.md`](./plan.md):

- [x] Phase 0 — Core object model (memory backend)
- [x] Phase 1 — Staging & commit
- [x] Phase 2 — History & branches
- [x] Phase 3 — Diff
- [x] Phase 4 — Remotes (smart HTTP fetch/push foundation)
- [x] Phase 5 — Merge (fast-forward + three-way conflict markers) and `.gitignore`
- [x] Phase 6 — Polish, docs, type consistency, canonical Git round-trip tests
- [x] Phase 7 — Canonical Smart HTTP transport (fetch/push against real Git servers)
- [x] Phase 9 — Node.js filesystem backend (`@slim-git/fs`)
- [ ] Phase 8 — Optional TypeORM SQL acceleration (on hold)

## Design principles

- **SDK-first**: import an API, not a CLI.
- **Storage-agnostic**: same core logic on memory, filesystem, or SQL backends.
- **Minimal dependencies**: Bun, TypeScript, and RxJS for reactive logic.
- **Explicit errors**: typed errors such as `NotFoundError`, `ConflictError`, and `UnsupportedError`.

## License

MIT
