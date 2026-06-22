import type { Branch, CreateBranchResult, CreateTagResult, DeleteBranchResult, DeleteTagResult, Oid, Tag } from "@slim-git/types";
import { ConflictError, NotFoundError, UnsupportedError } from "@slim-git/types";

/** Options used when creating a branch or tag. */
export interface RefCreateOptions {
  /** Target ref name or oid. Defaults to HEAD. */
  readonly target?: string;
}
import { concatMap, map, of, type Observable, throwError } from "rxjs";
import type { RefStore } from "./ref-store.js";

/** True if the string looks like a SHA-1 (40 hex) or SHA-256 (64 hex) oid. */
const looksLikeOid = (value: string): boolean =>
  /^[0-9a-f]{40}$/i.test(value) || /^[0-9a-f]{64}$/i.test(value);

/**
 * Operations on Git refs: branches, tags, and ref resolution.
 *
 * This service keeps ref-related logic out of the main `Repository` facade.
 */
export class RefService {
  constructor(private readonly refs: RefStore) {}

  /**
   * Resolves a ref name, branch/tag short name, or oid to an oid.
   * Handles symbolic refs of the form `ref: refs/heads/<name>` and falls back to
   * `refs/heads/<name>` and `refs/tags/<name>` for short names.
   */
  resolveRef(name: string): Observable<Oid | undefined> {
    if (looksLikeOid(name)) {
      return of(name as Oid);
    }

    const tryNames = [name, `refs/heads/${name}`, `refs/tags/${name}`];
    return this.tryResolveRefs$(tryNames);
  }

  private tryResolveRefs$(names: readonly string[]): Observable<Oid | undefined> {
    if (names.length === 0) {
      return of(undefined);
    }

    const [first, ...rest] = names;
    return this.refs.read(first!).pipe(
      concatMap((target) => {
        if (target === undefined) {
          return this.tryResolveRefs$(rest);
        }
        if (target.startsWith("ref: ")) {
          return this.resolveRef(target.slice(5));
        }
        return of(target as Oid);
      }),
    );
  }

  /** Creates a new branch pointing at `target` (default HEAD). */
  createBranch(name: string, options: RefCreateOptions = {}): Observable<CreateBranchResult> {
    const refName = `refs/heads/${name}`;
    const target$ =
      options.target !== undefined ? of(options.target as Oid) : this.resolveRef("HEAD");

    return this.refs.read(refName).pipe(
      concatMap((existing) => {
        if (existing !== undefined) {
          return throwError(() => new ConflictError(`branch ${name}`));
        }
        return target$;
      }),
      concatMap((target) => {
        if (target === undefined) {
          return throwError(() => new NotFoundError("HEAD"));
        }
        return this.refs.write(refName, target).pipe(map(() => ({ name, target })));
      }),
    );
  }

  /** Lists all local branches sorted by name. */
  listBranches(): Observable<Branch[]> {
    return this.refs.list("refs/heads/").pipe(
      map((refs) =>
        refs
          .map((ref) => ({
            name: ref.name.slice("refs/heads/".length),
            target: ref.target as Oid,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    );
  }

  /** Deletes a local branch. Refuses to delete the currently checked-out branch. */
  deleteBranch(name: string): Observable<DeleteBranchResult> {
    return this.getCurrentBranch().pipe(
      concatMap((current) => {
        if (current === name) {
          return throwError(() => new UnsupportedError("cannot delete the current branch"));
        }
        return this.refs.delete(`refs/heads/${name}`).pipe(map(() => ({ name })));
      }),
    );
  }

  /**
   * Returns the name of the current branch, or `undefined` if HEAD is detached.
   * Reads HEAD and parses symbolic refs like `ref: refs/heads/main`.
   */
  getCurrentBranch(): Observable<string | undefined> {
    return this.refs.read("HEAD").pipe(
      map((head) => {
        if (head === undefined || !head.startsWith("ref: refs/heads/")) {
          return undefined;
        }
        return head.slice("ref: refs/heads/".length);
      }),
    );
  }

  /** Creates a lightweight tag pointing at `target` (default HEAD). */
  createTag(name: string, options: RefCreateOptions = {}): Observable<CreateTagResult> {
    const refName = `refs/tags/${name}`;
    const target$ =
      options.target !== undefined ? of(options.target as Oid) : this.resolveRef("HEAD");

    return this.refs.read(refName).pipe(
      concatMap((existing) => {
        if (existing !== undefined) {
          return throwError(() => new ConflictError(`tag ${name}`));
        }
        return target$;
      }),
      concatMap((target) => {
        if (target === undefined) {
          return throwError(() => new NotFoundError("HEAD"));
        }
        return this.refs.write(refName, target).pipe(map(() => ({ name, target })));
      }),
    );
  }

  /** Lists all lightweight tags sorted by name. */
  listTags(): Observable<Tag[]> {
    return this.refs.list("refs/tags/").pipe(
      map((refs) =>
        refs
          .map((ref) => ({
            name: ref.name.slice("refs/tags/".length),
            target: ref.target as Oid,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    );
  }

  /** Deletes a lightweight tag. */
  deleteTag(name: string): Observable<DeleteTagResult> {
    return this.refs.delete(`refs/tags/${name}`).pipe(map(() => ({ name })));
  }
}
