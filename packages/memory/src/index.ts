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
import type {
  IndexWriteResult,
  RefDeleteResult,
  RefWriteResult,
  WorkspaceRemoveResult,
  WorkspaceWriteResult,
} from "@slim-git/types";
import { Index, NotFoundError, Repository as RepositoryImpl } from "@slim-git/core";
import { of, throwError, type Observable } from "rxjs";

/**
 * In-memory implementation of `StorageBackend`.
 *
 * Stores Git objects in a `Map<Oid, GitObject>`. Fast and deterministic,
 * making it ideal for unit tests and ephemeral operations.
 */
export class MemoryBackend implements StorageBackend {
  readonly name = "memory";

  private readonly objects = new Map<Oid, GitObject>();

  readObject(oid: Oid): Observable<GitObject> {
    const object = this.objects.get(oid);
    if (object === undefined) {
      return throwError(() => new NotFoundError(`object ${oid}`));
    }
    return of(object);
  }

  writeObject(object: GitObject): Observable<GitObject> {
    this.objects.set(object.oid, object);
    return of(object);
  }

  exists(oid: Oid): Observable<boolean> {
    return of(this.objects.has(oid));
  }
}

/** In-memory implementation of `RefStore` backed by a `Map<string, string>`. */
export class MemoryRefStore implements RefStore {
  private readonly refs = new Map<string, string>();

  read(ref: string): Observable<string | undefined> {
    return of(this.refs.get(ref));
  }

  write(ref: string, target: string): Observable<RefWriteResult> {
    this.refs.set(ref, target);
    return of({ ref, target });
  }

  delete(ref: string): Observable<RefDeleteResult> {
    this.refs.delete(ref);
    return of({ ref });
  }

  list(prefix: string): Observable<Ref[]> {
    return of(
      Array.from(this.refs.entries())
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, target]) => ({ name, target }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }
}

/** In-memory implementation of `IndexStore` that holds a single `Index` instance. */
export class MemoryIndexStore implements IndexStore {
  private index: Index = Index.empty();

  read(): Observable<Index> {
    return of(this.index);
  }

  write(index: Index): Observable<IndexWriteResult> {
    this.index = index;
    return of({ entries: index.paths.length });
  }
}

/** In-memory implementation of `WorkspaceBackend` backed by a `Map<string, Uint8Array>`. */
export class MemoryWorkspaceBackend implements WorkspaceBackend {
  readonly name = "memory-workspace";

  private readonly files = new Map<string, Uint8Array>();

  readFile(path: string): Observable<Uint8Array> {
    const content = this.files.get(path);
    if (content === undefined) {
      return throwError(() => new NotFoundError(`file ${path}`));
    }
    return of(content);
  }

  writeFile(path: string, content: Uint8Array): Observable<WorkspaceWriteResult> {
    this.files.set(path, content);
    return of({ path });
  }

  removeFile(path: string): Observable<WorkspaceRemoveResult> {
    this.files.delete(path);
    return of({ path });
  }

  listFiles(): Observable<string[]> {
    return of(Array.from(this.files.keys()).sort());
  }

  exists(path: string): Observable<boolean> {
    return of(this.files.has(path));
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
): Observable<Repository> =>
  RepositoryImpl.init(new MemoryBackend(), {
    ...options,
    refs: options.refs ?? new MemoryRefStore(),
    index: options.index ?? new MemoryIndexStore(),
    workspace: options.workspace ?? new MemoryWorkspaceBackend(),
  });
