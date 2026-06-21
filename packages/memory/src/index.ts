import type {
  GitObject,
  IndexStore,
  Oid,
  Ref,
  RefStore,
  Repository,
  RepositoryOptions,
  StorageBackend,
  WorkspaceBackend,
} from "@slim-git/core";
import { Index, NotFoundError, Repository as RepositoryImpl } from "@slim-git/core";

/**
 * In-memory implementation of `StorageBackend`.
 *
 * Stores Git objects in a `Map<Oid, GitObject>`. Fast and deterministic,
 * making it ideal for unit tests and ephemeral operations.
 */
export class MemoryBackend implements StorageBackend {
  readonly name = "memory";

  private readonly objects = new Map<Oid, GitObject>();

  async readObject(oid: Oid): Promise<GitObject> {
    const object = this.objects.get(oid);
    if (object === undefined) {
      throw new NotFoundError(`object ${oid}`);
    }
    return object;
  }

  async writeObject(object: GitObject): Promise<GitObject> {
    this.objects.set(object.oid, object);
    return object;
  }

  async exists(oid: Oid): Promise<boolean> {
    return this.objects.has(oid);
  }
}

/** In-memory implementation of `RefStore` backed by a `Map<string, string>`. */
export class MemoryRefStore implements RefStore {
  private readonly refs = new Map<string, string>();

  async read(ref: string): Promise<string | undefined> {
    return this.refs.get(ref);
  }

  async write(ref: string, target: string): Promise<void> {
    this.refs.set(ref, target);
  }

  async list(prefix: string): Promise<Ref[]> {
    return Array.from(this.refs.entries())
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, target]) => ({ name, target }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** In-memory implementation of `IndexStore` that holds a single `Index` instance. */
export class MemoryIndexStore implements IndexStore {
  private index: Index = Index.empty();

  async read(): Promise<Index> {
    return this.index;
  }

  async write(index: Index): Promise<void> {
    this.index = index;
  }
}

/** In-memory implementation of `WorkspaceBackend` backed by a `Map<string, Uint8Array>`. */
export class MemoryWorkspaceBackend implements WorkspaceBackend {
  readonly name = "memory-workspace";

  private readonly files = new Map<string, Uint8Array>();

  async readFile(path: string): Promise<Uint8Array> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new NotFoundError(`file ${path}`);
    }
    return content;
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    this.files.set(path, content);
  }

  async removeFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async listFiles(): Promise<string[]> {
    return Array.from(this.files.keys()).sort();
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

/** Options for creating an in-memory repository. */
export interface MemoryRepositoryOptions extends RepositoryOptions {
  readonly refs?: RefStore;
  readonly index?: IndexStore;
  readonly workspace?: WorkspaceBackend;
}

/**
 * Convenience factory that creates a repository with in-memory backends.
 * Useful for tests and for exploring the SDK without touching the filesystem.
 */
export const createMemoryRepository = (
  options: MemoryRepositoryOptions = {},
): Promise<Repository> =>
  RepositoryImpl.init(new MemoryBackend(), {
    ...options,
    refs: options.refs ?? new MemoryRefStore(),
    index: options.index ?? new MemoryIndexStore(),
    workspace: options.workspace ?? new MemoryWorkspaceBackend(),
  });
