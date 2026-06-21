import type { StorageBackend } from './backend.js';
import { DefaultHash, type HashAlgorithm } from './hash.js';
import { ObjectStore } from './object-store.js';

export interface RepositoryOptions {
  readonly hash?: HashAlgorithm;
}

export class Repository {
  readonly objectStore: ObjectStore;

  private constructor(
    readonly backend: StorageBackend,
    readonly hashAlgorithm: HashAlgorithm,
  ) {
    this.objectStore = new ObjectStore(backend, hashAlgorithm);
  }

  static async init(
    backend: StorageBackend,
    options: RepositoryOptions = {},
  ): Promise<Repository> {
    return new Repository(backend, options.hash ?? DefaultHash);
  }

  static async open(
    backend: StorageBackend,
    options: RepositoryOptions = {},
  ): Promise<Repository> {
    return new Repository(backend, options.hash ?? DefaultHash);
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
