export * from "@slim-git/types";
export * from "@slim-git/core";
export * from "@slim-git/memory";

import { Repository } from "@slim-git/core";
import type { RepositoryOptions, StorageBackend } from "@slim-git/core";

export const initRepository = (
  backend: StorageBackend,
  options?: RepositoryOptions,
): Promise<Repository> => Repository.init(backend, options);

export const openRepository = (
  backend: StorageBackend,
  options?: RepositoryOptions,
): Promise<Repository> => Repository.open(backend, options);
