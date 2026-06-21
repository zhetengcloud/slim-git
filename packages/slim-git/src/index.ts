/**
 * Public entry point for the `slim-git` SDK.
 *
 * Re-exports core types, the repository API, and the in-memory backend,
 * plus thin factory helpers for initializing or opening a repository.
 */
export * from "@slim-git/types";
export * from "@slim-git/core";
export * from "@slim-git/memory";

import { Repository } from "@slim-git/core";
import type { RepositoryOptions, StorageBackend } from "@slim-git/core";
import type { Observable } from "rxjs";

/**
 * Initializes a new repository backed by the given storage backend.
 * For an in-memory repository, prefer `createMemoryRepository()` from `@slim-git/memory`.
 */
export const initRepository = (
  backend: StorageBackend,
  options?: RepositoryOptions,
): Observable<Repository> => Repository.init(backend, options);

/**
 * Opens an existing repository backed by the given storage backend.
 * Currently equivalent to `initRepository`; behavior will expand with persistence.
 */
export const openRepository = (
  backend: StorageBackend,
  options?: RepositoryOptions,
): Observable<Repository> => Repository.open(backend, options);
