# AGENTS.md — slim-git Agent Instructions

This file contains project-specific instructions for coding agents working on **slim-git**, a lightweight, embeddable Git SDK in TypeScript. Read this file before modifying code.

## 1. Source of Truth

- Project vision, scope, phases, and architecture are in [`plan.md`](./plan.md).
- This file adds tooling and style constraints on top of `plan.md`.
- If `plan.md` and this file conflict, prefer this file for tooling/style and `plan.md` for product scope.

## 2. Runtime & Package Manager

- **Use Bun** as the only package manager and test runner.
- Run scripts with `bun run <script>`.
- Run tests with `bun test`.
- Run TypeScript directly with `bun` (no separate compile step for development).
- Target Node.js 18+ and ES2022.

## 3. Code Quality & Design

- Follow **SOLID principles**: single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion.
- Prefer **pure functions** and **immutable data**; avoid mutating shared state.
- Keep functions small and focused; avoid long imperative procedures.
- Use explicit TypeScript types; do not rely on `any`.
- Prefer dependency injection over static/global state, especially for storage backends.
- Design for the storage-backend abstraction described in `plan.md` §7.

## 3.5 Comments & Documentation

- Add concise comments that explain **why** and **what**, not just restate the code.
- Document all public exports (interfaces, classes, functions, and type aliases) with TSDoc-style comments.
- Comment non-obvious algorithms, Git format details, and performance trade-offs.
- Keep comments close to the code they describe; prefer inline comments over long preamble blocks.
- Update comments when the code they describe changes.

## 4. Style: Declarative & Reactive

- Use **RxJS** for asynchronous and event-driven logic.
- Prefer **declarative** operators (`map`, `filter`, `mergeMap`, `switchMap`, `scan`, `combineLatest`, etc.) over imperative loops and conditionals.
- Avoid `for`, `while`, `if/else` chains where RxJS operators or array methods (`map`, `filter`, `reduce`, `flatMap`) express the intent more clearly.
- Imperative constructs are acceptable only at clear I/O boundaries or when performance/algorithmic clarity demands it; document why when used.
- Treat streams as first-class citizens for history traversal, status updates, and transport events.

## 5. Lint & Format

- Use **Oxc** for both linting and formatting.
- Run `bunx oxlint@latest` for lint checks.
- Run `bunx dprint fmt` or the configured formatter command for formatting.
- Do not introduce lint suppressions without a comment explaining why.
- Keep the codebase formatting consistent; format before committing.

## 6. Testing

- Write **reasonable unit tests** for all public SDK methods and core internal functions.
- Prefer the **in-memory backend** for unit tests to keep them fast and deterministic.
- Add integration tests that round-trip against canonical `git` CLI for the supported subset.
- Use property-based tests where they add value (e.g., content-addressing, index consistency).
- Tests should be clear, isolated, and run with `bun test`.
- Aim for high coverage on the core object model, refs, index, and commit path.
- Keep tests in a `test/` folder within each package; avoid co-locating `.test.ts` files with source files.
- In tests, import the package under test through its workspace name (e.g. `@slim-git/core`) instead of using relative `../src/` paths.

## 7. Git Commits

- Make **reasonable, human-reviewable commits**.
- Each commit should be a single logical change.
- Write clear commit messages in the imperative mood:
  - `feat:` new feature
  - `fix:` bug fix
  - `refactor:` code change that neither fixes a bug nor adds a feature
  - `test:` adding or updating tests
  - `docs:` documentation changes
  - `chore:` tooling, dependency, or build changes
- Avoid giant commits that mix unrelated changes.
- Do not run destructive git mutations (reset, rebase, force-push) unless explicitly asked.

## 8. Project Layout

Follow the monorepo layout from `plan.md` §10 under `packages/`:

```text
packages/
├── slim-git            # Main SDK
├── @slim-git/core      # Object store, refs, index, config
├── @slim-git/fs        # Node FS backend
├── @slim-git/memory    # In-memory backend
├── @slim-git/sql       # Optional TypeORM SQL acceleration layer
├── @slim-git/http      # Smart HTTP transport
└── @slim-git/types     # Shared TypeScript types
```

Keep packages focused; do not leak backend-specific code into `@slim-git/core`.

## 9. Error Handling

- Fail explicitly with clear, actionable errors when unsupported operations are requested.
- Use typed errors where possible so consumers can distinguish cases (e.g., `NotFoundError`, `ConflictError`, `UnsupportedError`).
- Do not swallow exceptions silently.

## 10. Dependencies

- Keep dependencies minimal; slim-git is intentionally slim.
- RxJS is a core dependency for the reactive style.
- TypeORM and SQL drivers are optional peer dependencies for the SQL acceleration package.
- No native dependencies in the core packages.

## 11. Before Submitting Code

1. Format and lint pass: `bunx oxlint@latest` and the format command.
2. TypeScript compiles cleanly: `bun tsc --noEmit`.
3. Tests pass: `bun test`.
4. Changes match the current phase in `plan.md` §9.
5. Commit messages follow §7.
