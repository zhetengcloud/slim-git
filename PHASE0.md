# Phase 0 Implementation Plan — Core Object Model (Memory Backend)

## Goal

Implement the foundational object model and repository lifecycle for slim-git, backed by the in-memory storage backend. This keeps tests fast and deterministic while defining the interfaces that the Node FS backend will implement later.

## Packages to Create

```text
packages/
├── @slim-git/types     # Shared TypeScript types and constants
├── @slim-git/core      # Backend abstraction, object model, repository core
├── @slim-git/memory    # In-memory storage backend implementation
└── slim-git            # Main SDK entry point (thin wrapper for Phase 0)
```

## 1. @slim-git/types

- Git object types: `blob`, `tree`, `commit`, `tag`.
- `ObjectType` union type.
- `Oid` branded string type.
- `GitObject` interface: `{ type: ObjectType; content: Uint8Array; oid: Oid }`.
- `Ref` type and basic ref helpers.
- `HashAlgorithm` identifier: `'sha1' | 'sha256'`.
- Error type markers: `NotFoundError`, `UnsupportedError`, `ConflictError`.

## 2. @slim-git/core

### Hash abstraction

- `HashAlgorithm` interface: `hash(data: Uint8Array): Oid`.
- Concrete implementations: `Sha1Hash` and `Sha256Hash`.
- Default: SHA-1.
- Kept behind an interface so callers can inject SHA-256 later without changing core logic.

### Storage backend interface

```ts
interface StorageBackend {
  readObject(oid: Oid): Promise<GitObject>;
  writeObject(type: ObjectType, content: Uint8Array): Promise<GitObject>;
  exists(oid: Oid): Promise<boolean>;
}
```

### Object model

- `ObjectStore` class wrapping a `StorageBackend` + `HashAlgorithm`.
- Methods:
  - `hashObject(type, content)` → `GitObject`
  - `read(oid)` → `GitObject`
  - `write(object)` → `GitObject`
  - `exists(oid)` → `boolean`
- Internals use declarative array methods (`map`, `filter`, `reduce`) and avoid deep nesting.

### Repository lifecycle

- `Repository` class:
  - `init(backend, options?)` static factory.
  - `open(backend)` static factory.
  - `objectStore` accessor.
  - `destroy()` cleanup.
- `RepositoryOptions` allows choosing hash algorithm.

## 3. @slim-git/memory

- `MemoryBackend` class implementing `StorageBackend`.
- Stores objects in a `Map<Oid, GitObject>`.
- Thread-safe for single-threaded Bun usage.
- No persistence; fresh on each instantiation.

## 4. slim-git

- Public entry point re-exporting:
  - `initRepository(backend, options)`
  - `openRepository(backend)`
  - Core types from `@slim-git/types`
- Minimal for Phase 0; grows as phases land.

## 5. Testing

- Unit tests in each package using Bun's test runner and `MemoryBackend`.
- Coverage targets:
  - SHA-1 hashing matches canonical Git object IDs for known inputs.
  - Object write/read round-trip preserves type, content, and oid.
  - `exists()` returns true after write, false for unknown oid.
  - Repository init/open return valid instances.
  - SHA-256 can be injected and produces different, stable oids.

## 6. Style & Constraints

- Bun for builds/tests.
- RxJS for async composition where it improves readability; otherwise prefer `map`/`filter`/`reduce`.
- No `for`/`while` loops or deeply nested `if/else` unless unavoidable and documented.
- SOLID: small functions, dependency injection, interface segregation.
- Oxc lint and format before commit.

## 7. Out of Scope for Phase 0

- Node FS backend.
- Refs, index, config, ignore.
- Commits, branches, diff, remotes, merge.
- Packfiles.
- TypeORM/SQL acceleration.
