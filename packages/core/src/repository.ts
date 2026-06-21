import type {
  AddResult,
  Branch,
  CheckoutResult,
  CommitInfo,
  CreateBranchResult,
  CreateTagResult,
  DeleteBranchResult,
  DeleteTagResult,
  DestroyResult,
  Diff,
  IndexEntry,
  LogOptions,
  MergeResult,
  Oid,
  Person,
  Remote,
  RemoveResult,
  RestoreResult,
  Status,
  Tag,
} from "@slim-git/types";
import { ConflictError, NotFoundError, UnsupportedError } from "@slim-git/types";
import type { StorageBackend } from "./backend.js";
import { CommitBuilder } from "./commit-builder.js";
import type { Config } from "./config.js";
import { parseCommit$ } from "./commit-parser.js";
import { DefaultHash, type HashAlgorithm } from "./hash.js";
import { Index } from "./index-model.js";
import type { IndexStore } from "./index-store.js";
import { ObjectStore } from "./object-store.js";
import type { RefStore } from "./ref-store.js";
import { TreeBuilder } from "./tree-builder.js";
import type { TreeEntryMap } from "./tree-utils.js";
import { findInTree$, flattenTree$ } from "./tree-utils.js";
import type { WorkspaceBackend } from "./workspace-backend.js";
import {
  diffHeadRef,
  diffIndexHead,
  diffWorktreeIndex,
} from "./repository-diff.js";
import { fastForwardMerge } from "./repository-merge.js";
import { addRemote, listRemotes, removeRemote } from "./repository-remotes.js";
import {
  combineLatest,
  concatMap,
  defaultIfEmpty,
  distinct,
  expand,
  forkJoin,
  from,
  map,
  of,
  type Observable,
  throwError,
} from "rxjs";

/** Options used when initializing or opening a repository. */
export interface RepositoryOptions {
  readonly hash?: HashAlgorithm;
  readonly refs?: RefStore;
  readonly index?: IndexStore;
  readonly workspace?: WorkspaceBackend;
  readonly config?: Config;
}

/** Options used when creating or amending a commit. */
export interface CommitOptions {
  readonly message: string;
  readonly author: Person;
  readonly committer?: Person;
}

/** Options used when creating a branch or tag. */
export interface RefCreateOptions {
  /** Target ref name or oid. Defaults to HEAD. */
  readonly target?: string;
}

/** Default file mode used for regular files staged into the index. */
const DefaultFileMode = 0o100644;

/**
 * True if the string looks like a SHA-1 (40 hex) or SHA-256 (64 hex) oid.
 */
const looksLikeOid = (value: string): boolean =>
  /^[0-9a-f]{40}$/i.test(value) || /^[0-9a-f]{64}$/i.test(value);

/**
 * Creates an index entry from a workspace file.
 * Timestamps are set to the current time; device/inode fields are zeroed because
 * the memory backend does not track real filesystem metadata.
 */
const createIndexEntry = (path: string, oid: Oid, content: Uint8Array): IndexEntry => {
  const now = new Date();
  const timestampSeconds = Math.floor(now.getTime() / 1000);

  return {
    path,
    oid,
    mode: DefaultFileMode,
    stage: 0,
    fileSize: content.length,
    ctimeSeconds: timestampSeconds,
    ctimeNanos: 0,
    mtimeSeconds: timestampSeconds,
    mtimeNanos: 0,
    dev: 0,
    ino: 0,
    uid: 0,
    gid: 0,
    assumeValid: false,
    extended: false,
    skipWorktree: false,
    intentToAdd: false,
  };
};

/**
 * High-level repository API.
 *
 * `Repository` wires together storage, refs, index, workspace, and the object store
 * to provide the everyday Git operations implemented by slim-git.
 *
 * All async operations return RxJS `Observable`s. Consumers unwrap values with
 * `lastValueFrom`, `firstValueFrom`, or any RxJS operator.
 */
export class Repository {
  readonly objectStore: ObjectStore;
  readonly refs: RefStore;
  readonly indexStore: IndexStore;
  readonly workspace: WorkspaceBackend;
  readonly config: Config;

  private constructor(
    readonly backend: StorageBackend,
    readonly hashAlgorithm: HashAlgorithm,
    refs: RefStore,
    indexStore: IndexStore,
    workspace: WorkspaceBackend,
    config: Config,
  ) {
    this.objectStore = new ObjectStore(backend, hashAlgorithm);
    this.refs = refs;
    this.indexStore = indexStore;
    this.workspace = workspace;
    this.config = config;
  }

  /** Creates a fresh repository instance backed by the given storage backend. */
  static init(backend: StorageBackend, options: RepositoryOptions = {}): Observable<Repository> {
    return of(
      new Repository(
        backend,
        options.hash ?? DefaultHash,
        options.refs ?? {
          read: (_ref) => of(undefined),
          write: (_ref, target) => of({ ref: _ref, target }),
          delete: (_ref) => of({ ref: _ref }),
          list: () => of([]),
        },
        options.index ?? {
          read: () => of(Index.empty()),
          write: (index) => of({ entries: index.paths.length }),
        },
        options.workspace ?? {
          name: "noop",
          readFile: () => of(new Uint8Array()),
          writeFile: (path) => of({ path }),
          removeFile: (path) => of({ path }),
          listFiles: () => of([]),
          exists: () => of(false),
        },
        options.config ?? {
          get: () => of(undefined),
          set: () => of(undefined),
          remove: () => of(undefined),
          list: () => of([]),
        },
      ),
    );
  }

  /**
   * Opens an existing repository.
   * Currently equivalent to `init` because slim-git does not yet persist repository
   * metadata; this will evolve once the filesystem backend lands.
   */
  static open(backend: StorageBackend, options: RepositoryOptions = {}): Observable<Repository> {
    return Repository.init(backend, options);
  }

  /**
   * Compares the workspace against the index and HEAD.
   *
   * - `staged` — index entries that differ from HEAD.
   * - `modified` — tracked files whose workspace content differs from the index.
   * - `deleted` — tracked files that no longer exist in the workspace.
   * - `untracked` — workspace files not present in the index.
   */
  status(): Observable<Status> {
    return combineLatest([
      this.indexStore.read(),
      this.workspace.listFiles(),
      this.readHeadTree$(),
    ]).pipe(
      concatMap(([index, workspaceFiles, headTree]) =>
        this.computeStaged$(index, headTree).pipe(
          concatMap((staged) =>
            this.computeTrackedChanges$(index).pipe(map((changes) => ({ staged, ...changes }))),
          ),
          map(({ staged, modified, deleted }) => {
            const tracked = new Set(index.paths);
            const untracked = workspaceFiles.filter((path) => !tracked.has(path));
            return { staged, modified, deleted, untracked };
          }),
        ),
      ),
    );
  }

  /** Reads HEAD and returns the tree oid of the commit it points to, if any. */
  private readHeadTree$(): Observable<Oid | undefined> {
    return this.resolveRef("HEAD").pipe(
      concatMap((head) => {
        if (head === undefined) {
          return of(undefined);
        }
        return this.readCommitTree$(head);
      }),
    );
  }

  /** Reads a commit object and returns the oid of its tree. */
  readCommitTree$(oid: Oid): Observable<Oid> {
    return this.objectStore.read(oid).pipe(
      concatMap((commit) => parseCommit$(commit)),
      map((info) => info.tree),
    );
  }

  /** Computes modified/deleted changes for all tracked paths. */
  private computeTrackedChanges$(
    index: Index,
  ): Observable<{ modified: string[]; deleted: string[] }> {
    if (index.paths.length === 0) {
      return of({ modified: [], deleted: [] });
    }

    return forkJoin(
      index.paths.map((path) =>
        this.workspace.exists(path).pipe(
          concatMap((exists) => {
            if (!exists) {
              return of({ path, kind: "deleted" as const });
            }
            return this.workspace.readFile(path).pipe(
              map((content) => {
                const blob = this.objectStore.hashObject("blob", content);
                return blob.oid !== index.get(path)?.oid
                  ? { path, kind: "modified" as const }
                  : undefined;
              }),
            );
          }),
        ),
      ),
    ).pipe(
      map((changes) => ({
        modified: changes
          .filter((change) => change?.kind === "modified")
          .map((change) => change!.path),
        deleted: changes
          .filter((change) => change?.kind === "deleted")
          .map((change) => change!.path),
      })),
    );
  }

  /**
   * Computes staged paths by comparing each index entry to its counterpart
   * in the HEAD tree. When there is no HEAD, every path is considered staged.
   */
  private computeStaged$(index: Index, headTree: Oid | undefined): Observable<string[]> {
    if (headTree === undefined || index.paths.length === 0) {
      return of(index.paths);
    }

    return forkJoin(
      index.paths.map((path) => {
        const entry = index.get(path);
        if (entry === undefined) {
          return of(undefined);
        }
        return findInTree$(this.objectStore, headTree, path.split("/").filter(Boolean)).pipe(
          map((headEntry) => (headEntry?.oid !== entry.oid ? path : undefined)),
        );
      }),
    ).pipe(map((changes) => changes.filter((path): path is string => path !== undefined)));
  }

  /** Stages workspace files as blobs in the index. */
  add(paths: readonly string[]): Observable<AddResult> {
    return this.indexStore.read().pipe(
      concatMap((index) =>
        paths.reduce<Observable<Index>>(
          (index$, path) =>
            index$.pipe(
              concatMap((currentIndex) =>
                this.workspace.readFile(path).pipe(
                  concatMap((content) =>
                    this.objectStore
                      .write("blob", content)
                      .pipe(map((blob) => ({ blob, content }))),
                  ),
                  map(({ blob, content }) =>
                    currentIndex.add(createIndexEntry(path, blob.oid, content)),
                  ),
                ),
              ),
            ),
          of(index),
        ),
      ),
      concatMap((next) => this.indexStore.write(next)),
      map(() => ({ added: paths })),
    );
  }

  /** Removes files from both the workspace and the index. */
  remove(paths: readonly string[]): Observable<RemoveResult> {
    return this.indexStore.read().pipe(
      concatMap((index) =>
        forkJoin(paths.map((path) => this.workspace.removeFile(path))).pipe(
          defaultIfEmpty([]),
          map(() => index.removeMany(paths)),
        ),
      ),
      concatMap((next) => this.indexStore.write(next)),
      map(() => ({ removed: paths })),
    );
  }

  /** Writes the indexed version of each path back into the workspace. */
  restore(paths: readonly string[]): Observable<RestoreResult> {
    return this.indexStore.read().pipe(
      concatMap((index) =>
        forkJoin(
          paths.map((path) => {
            const entry = index.get(path);
            if (entry === undefined) {
              return of(undefined);
            }
            return this.objectStore
              .read(entry.oid)
              .pipe(concatMap((object) => this.workspace.writeFile(path, object.content)));
          }),
        ),
      ),
      defaultIfEmpty([]),
      map(() => ({ restored: paths })),
    );
  }

  /**
   * Creates a commit from the current index, updates HEAD, and clears the index.
   *
   * Note: clearing the index after commit is the current slim-git behavior for the
   * memory backend; it will be revised to match canonical Git once persistence lands.
   */
  commit(options: CommitOptions): Observable<Oid> {
    return combineLatest([this.indexStore.read(), this.resolveRef("HEAD")]).pipe(
      concatMap(([index, parent]) =>
        this.buildTreeFromIndex$(index).pipe(
          map((treeOid) => {
            const builder = new CommitBuilder()
              .tree(treeOid)
              .author(options.author)
              .committer(options.committer ?? options.author)
              .message(options.message);
            if (parent !== undefined) {
              builder.parent(parent);
            }
            return builder;
          }),
        ),
      ),
      concatMap((builder) => builder.build(this.objectStore)),
      concatMap((commitOid) => this.updateHeadRef$(commitOid)),
    );
  }

  /** Rewrites the current HEAD commit in place, keeping its tree and parents. */
  amend(options: CommitOptions): Observable<Oid> {
    return this.amend$(options);
  }

  private amend$(options: CommitOptions): Observable<Oid> {
    return this.resolveRef("HEAD").pipe(
      concatMap((headTarget) => {
        if (headTarget === undefined) {
          return throwError(() => new Error("Cannot amend: HEAD does not exist"));
        }
        return this.objectStore.read(headTarget).pipe(
          concatMap((headCommit) => parseCommit$(headCommit)),
          concatMap((info) => {
            const builder = new CommitBuilder()
              .tree(info.tree)
              .parentsList(info.parents)
              .author(options.author)
              .committer(options.committer ?? options.author)
              .message(options.message);
            return builder.build(this.objectStore);
          }),
          concatMap((commitOid) => this.updateHeadRef$(commitOid)),
        );
      }),
    );
  }

  /**
   * Moves HEAD to `commitOid`. If HEAD is a symbolic ref to a branch, the branch
   * is updated and HEAD remains symbolic.
   */
  private updateHeadRef$(commitOid: Oid): Observable<Oid> {
    return this.refs.read("HEAD").pipe(
      concatMap((headValue) => {
        const branchRef = headValue?.startsWith("ref: ")
          ? headValue.slice("ref: ".length)
          : undefined;
        const targetRef$ = branchRef !== undefined ? of(branchRef) : of("HEAD");
        return targetRef$.pipe(
          concatMap((ref) => this.refs.write(ref, commitOid)),
          concatMap(() => this.indexStore.write(Index.empty())),
          map(() => commitOid),
        );
      }),
    );
  }

  /**
   * Returns an Observable that emits commit history starting from HEAD or the given ref.
   *
   * The stream walks parents breadth-first, deduplicates shared ancestors, and can be
   * composed with any RxJS operators (e.g. `take(10)`).
   */
  log(options: LogOptions = {}): Observable<CommitInfo> {
    const startRef = options.ref ?? "HEAD";

    return this.resolveCommitInfo$(startRef).pipe(
      expand((commit) =>
        from(commit.parents).pipe(concatMap((parent) => this.resolveCommitInfo$(parent))),
      ),
      distinct((commit) => commit.oid),
    );
  }

  /** Resolves a ref name, branch name, or oid to a `CommitInfo`. */
  private resolveCommitInfo$(ref: string): Observable<CommitInfo> {
    return this.resolveRef(ref).pipe(
      concatMap((oid) => {
        if (oid === undefined) {
          return throwError(() => new NotFoundError(`ref ${ref}`));
        }
        return this.objectStore.read(oid).pipe(concatMap((object) => parseCommit$(object)));
      }),
    );
  }

  /**
   * Resolves a ref name, branch/tag short name, or oid to an oid.
   * Handles symbolic refs of the form `ref: refs/heads/main` and falls back to
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
    return this.createBranch$(name, options);
  }

  private createBranch$(name: string, options: RefCreateOptions): Observable<CreateBranchResult> {
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
    return this.deleteBranch$(name);
  }

  private deleteBranch$(name: string): Observable<DeleteBranchResult> {
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

  /**
   * Switches the working tree and index to a branch or commit.
   *
   * - If `target` matches a branch name, HEAD becomes a symbolic ref to that branch.
   * - If `target` is a commit oid, HEAD becomes detached at that commit.
   */
  checkout(target: string): Observable<CheckoutResult> {
    return this.checkout$(target);
  }

  private checkout$(target: string): Observable<CheckoutResult> {
    const branchRef = `refs/heads/${target}`;

    return this.refs.read(branchRef).pipe(
      concatMap((branchTarget) => {
        if (branchTarget !== undefined) {
          return of({ commitOid: branchTarget as Oid, headValue: `ref: ${branchRef}` });
        }
        const oid = target as Oid;
        return this.objectStore.read(oid).pipe(
          concatMap((object) => {
            if (object.type !== "commit") {
              return throwError(() => new NotFoundError(`commit ${target}`));
            }
            return of({ commitOid: oid, headValue: target });
          }),
        );
      }),
      concatMap(({ commitOid, headValue }) =>
        this.readCommitTree$(commitOid).pipe(
          concatMap((treeOid) => flattenTree$(this.objectStore, treeOid)),
          concatMap((treeEntries) => this.applyTreeToWorkspace$(treeEntries)),
          concatMap((treeEntries) => this.buildIndexFromTree$(treeEntries)),
          concatMap((index) => this.refs.write("HEAD", headValue).pipe(map(() => index))),
          concatMap((index) =>
            this.indexStore.write(index).pipe(
              map(() => ({
                commitOid,
                branch: headValue.startsWith("ref: ")
                  ? headValue.slice("ref: refs/heads/".length)
                  : undefined,
              })),
            ),
          ),
        ),
      ),
    );
  }

  /** Removes workspace files not present in the target tree and writes the tree files. */
  applyTreeToWorkspace$(
    treeEntries: Map<string, TreeEntryMap>,
  ): Observable<Map<string, TreeEntryMap>> {
    return this.workspace.listFiles().pipe(
      concatMap((workspaceFiles) => {
        const toRemove = workspaceFiles.filter((path) => !treeEntries.has(path));
        return forkJoin(toRemove.map((path) => this.workspace.removeFile(path))).pipe(
          defaultIfEmpty([]),
          map(() => treeEntries),
        );
      }),
      concatMap((entries) =>
        forkJoin(
          Array.from(entries).map(([path, entry]) =>
            this.objectStore
              .read(entry.oid)
              .pipe(concatMap((object) => this.workspace.writeFile(path, object.content))),
          ),
        ).pipe(
          defaultIfEmpty([]),
          map(() => entries),
        ),
      ),
    );
  }

  /** Builds an index from a flattened tree. */
  buildIndexFromTree$(treeEntries: Map<string, TreeEntryMap>): Observable<Index> {
    return Array.from(treeEntries).reduce<Observable<Index>>(
      (index$, [path, entry]) =>
        index$.pipe(
          concatMap((index) =>
            this.objectStore
              .read(entry.oid)
              .pipe(map((object) => index.add(createIndexEntry(path, entry.oid, object.content)))),
          ),
        ),
      of(Index.empty()),
    );
  }

  /** Creates a lightweight tag pointing at `target` (default HEAD). */
  createTag(name: string, options: RefCreateOptions = {}): Observable<CreateTagResult> {
    return this.createTag$(name, options);
  }

  private createTag$(name: string, options: RefCreateOptions): Observable<CreateTagResult> {
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

  /** Adds a remote repository. */
  addRemote(name: string, url: string): Observable<Remote> {
    return addRemote(this.config, name, url);
  }

  /** Removes a remote repository and its configuration. */
  removeRemote(name: string): Observable<void> {
    return removeRemote(this.config, name);
  }

  /** Lists all configured remotes sorted by name. */
  listRemotes(): Observable<Remote[]> {
    return listRemotes(this.config);
  }

  /** Performs a fast-forward merge of the current branch to `target`. */
  fastForwardMerge(target: string): Observable<MergeResult> {
    return fastForwardMerge(this, target);
  }

  /** Updates the workspace and index to match a commit's tree without moving HEAD. */
  applyCommit$(commitOid: Oid): Observable<void> {
    return this.readCommitTree$(commitOid).pipe(
      concatMap((treeOid) => flattenTree$(this.objectStore, treeOid)),
      concatMap((treeEntries) => this.applyTreeToWorkspace$(treeEntries)),
      concatMap((treeEntries) => this.buildIndexFromTree$(treeEntries)),
      concatMap((index) => this.indexStore.write(index)),
      map(() => undefined),
    );
  }

  /** Builds a tree object from every entry in the index and returns its oid. */
  private buildTreeFromIndex$(index: Index): Observable<Oid> {
    const builder = index.toArray().reduce((tree, entry) => {
      return tree.insert(entry.path, entry.oid, entry.mode);
    }, new TreeBuilder());

    return builder.build(this.objectStore);
  }

  /** Releases any resources held by the repository. */
  destroy(): Observable<DestroyResult> {
    return of({ destroyed: true });
  }

  /** Computes a diff between the index and the working tree. */
  diffWorktreeIndex(): Observable<Diff> {
    return diffWorktreeIndex(this);
  }

  /** Computes a diff between HEAD and the index. */
  diffIndexHead(): Observable<Diff> {
    return diffIndexHead(this);
  }

  /** Computes a diff between the given ref, branch, or oid and HEAD. */
  diffHeadRef(ref: string): Observable<Diff> {
    return diffHeadRef(this, ref);
  }
}
