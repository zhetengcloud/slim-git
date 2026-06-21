# Phase 1 Implementation Plan — Staging & Commit

## Goal

Implement the staging area (index), working-tree operations, and the first commit path, all backed by the in-memory backend.

## Packages affected

- `packages/types` — new index, ref, tree, and commit types
- `packages/core` — `RefStore`/`IndexStore` abstractions, `WorkspaceBackend`, `Index`, `TreeBuilder`, `CommitBuilder`, repository methods
- `packages/memory` — in-memory implementations of ref/index/workspace stores
- `packages/slim-git` — re-exports and thin SDK methods

## 1. New abstractions in `packages/core`

### RefStore

```ts
interface RefStore {
  read(ref: string): Promise<string | undefined>;
  write(ref: string, target: string): Promise<void>;
  list(prefix: string): Promise<Ref[]>;
}
```

Used for `HEAD`, `refs/heads/*`, and later `refs/tags/*`.

### IndexStore

```ts
interface IndexStore {
  read(): Promise<Index>;
  write(index: Index): Promise<void>;
}
```

### WorkspaceBackend

```ts
interface WorkspaceBackend {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
  removeFile(path: string): Promise<void>;
  listFiles(): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}
```

Separates working-tree I/O from object storage so the same core logic runs on memory and Node FS backends.

## 2. Data models in `packages/types`

- `IndexEntry`: path, oid, mode, stage, file size, timestamps
- `Index`: a collection of entries keyed by path
- `Ref`: name + target
- `TreeEntry`: mode, name, oid
- `CommitInfo`: tree oid, parents, author, committer, message
- `Person`: name, email, timestamp

## 3. Builders in `packages/core`

### Index

- `add(entry)` / `remove(path)` / `get(path)` / `entries()`
- Declarative operations using `map`/`filter`/`reduce`

### TreeBuilder

- `insert(path, oid, mode)` — splits paths into tree entries recursively
- `build(store)` — writes tree objects bottom-up and returns root tree oid

### CommitBuilder

- `parent(parentOid)` / `tree(treeOid)` / `message(text)` / `author(person)` / `committer(person)`
- `build(store, hash)` — serializes and writes the commit object, returns commit oid

## 4. Repository methods

Extend `Repository` with:

- `status()` — compare workspace vs index, report modified/staged/untracked
- `add(paths)` — read workspace files, hash blobs, stage entries
- `remove(paths)` — remove entries from index
- `restore(paths)` — write indexed content back to workspace
- `commit(options)` — build tree from index, create commit, update HEAD
- `amend(options)` — rewrite the current HEAD commit in place

## 5. Memory implementations in `packages/memory`

- `MemoryRefStore` — `Map<string, string>`
- `MemoryIndexStore` — holds a single `Index` instance
- `MemoryWorkspaceBackend` — `Map<string, Uint8Array>`
- Bundle them in `MemoryBackend` or expose a `createMemoryRepository()` helper

## 6. Testing

- Index add/remove/get operations
- TreeBuilder produces correct nested tree oids
- CommitBuilder produces a canonical commit oid (verify against `git hash-object -t commit`)
- `add` then `commit` updates HEAD
- `amend` keeps the same tree but changes message/parents
- `status` reports staged/modified/untracked files correctly

## 7. Style & constraints

- Bun, TypeScript strict, oxfmt/oxlint
- RxJS for async orchestration where it improves readability
- Declarative array operations otherwise
- No imperative loops or deep nesting
- SOLID: small focused functions, dependency injection
