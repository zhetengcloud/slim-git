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
  FetchResult,
  LogOptions,
  MergeResult,
  Oid,
  PushResult,
  Remote,
  RemoveResult,
  RestoreResult,
  Status,
  Tag,
} from "@slim-git/types";
import type { StorageBackend } from "./backend.js";
import { CheckoutService } from "./checkout-service.js";
import type { Config } from "./config.js";
import { DefaultHash, type HashAlgorithm } from "./hash.js";
import { Index } from "./index-model.js";
import type { IndexStore } from "./index-store.js";
import { ObjectStore } from "./object-store.js";
import type { RefStore } from "./ref-store.js";
import type { TreeEntryMap } from "./tree-utils.js";
import { readCommitTree$ } from "./tree-utils.js";
import { RefService, type RefCreateOptions } from "./ref-service.js";
import { StatusService } from "./status-service.js";
import { StagingService } from "./staging-service.js";
import { CommitService, type CommitOptions } from "./commit-service.js";
import { HistoryService } from "./history-service.js";
import type { WorkspaceBackend } from "./workspace-backend.js";
import { diffHeadRef, diffIndexHead, diffWorktreeIndex } from "./repository-diff.js";
import { fastForwardMerge, merge, type MergeOptions } from "./repository-merge.js";
import { RemoteService, type RemoveRemoteResult } from "./remote-service.js";
import { fetch, pull, push, type FetchOptions } from "./repository-fetch.js";
import type { Transport } from "./transport.js";
import { of, type Observable } from "rxjs";

export type { CommitOptions };

/** Options used when initializing or opening a repository. */
export interface RepositoryOptions {
  readonly hash?: HashAlgorithm;
  readonly refs?: RefStore;
  readonly index?: IndexStore;
  readonly workspace?: WorkspaceBackend;
  readonly config?: Config;
}

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

  private readonly refService: RefService;
  private readonly statusService: StatusService;
  private readonly stagingService: StagingService;
  private readonly commitService: CommitService;
  private readonly historyService: HistoryService;
  private readonly checkoutService: CheckoutService;
  private readonly remoteService: RemoteService;

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
    this.refService = new RefService(refs);
    this.statusService = new StatusService(
      this.objectStore,
      indexStore,
      workspace,
      this.refService,
    );
    this.stagingService = new StagingService(this.objectStore, indexStore, workspace);
    this.commitService = new CommitService(this.objectStore, indexStore, this.refService);
    this.historyService = new HistoryService(this.objectStore, this.refService);
    this.checkoutService = new CheckoutService(this.objectStore, refs, indexStore, workspace);
    this.remoteService = new RemoteService(config);
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
    return this.statusService.status();
  }

  /** Reads a commit object and returns the oid of its tree. */
  readCommitTree$(oid: Oid): Observable<Oid> {
    return readCommitTree$(this.objectStore, oid);
  }

  /** Stages workspace files as blobs in the index, skipping ignored paths. */
  add(paths: readonly string[]): Observable<AddResult> {
    return this.stagingService.add(paths);
  }

  /** Removes files from both the workspace and the index. */
  remove(paths: readonly string[]): Observable<RemoveResult> {
    return this.stagingService.remove(paths);
  }

  /** Writes the indexed version of each path back into the workspace. */
  restore(paths: readonly string[]): Observable<RestoreResult> {
    return this.stagingService.restore(paths);
  }

  /**
   * Creates a commit from the current index, updates HEAD, and clears the index.
   *
   * Note: clearing the index after commit is the current slim-git behavior for the
   * memory backend; it will be revised to match canonical Git once persistence lands.
   */
  commit(options: CommitOptions): Observable<Oid> {
    return this.commitService.commit(options);
  }

  /** Rewrites the current HEAD commit in place, keeping its tree and parents. */
  amend(options: CommitOptions): Observable<Oid> {
    return this.commitService.amend(options);
  }

  /**
   * Returns an Observable that emits commit history starting from HEAD or the given ref.
   *
   * The stream walks parents breadth-first, deduplicates shared ancestors, and can be
   * composed with any RxJS operators (e.g. `take(10)`).
   */
  log(options: LogOptions = {}): Observable<CommitInfo> {
    return this.historyService.log(options);
  }

  /**
   * Resolves a ref name, branch/tag short name, or oid to an oid.
   * Handles symbolic refs of the form `ref: refs/heads/main` and falls back to
   * `refs/heads/<name>` and `refs/tags/<name>` for short names.
   */
  resolveRef(name: string): Observable<Oid | undefined> {
    return this.refService.resolveRef(name);
  }

  /** Creates a new branch pointing at `target` (default HEAD). */
  createBranch(name: string, options: RefCreateOptions = {}): Observable<CreateBranchResult> {
    return this.refService.createBranch(name, options);
  }

  /** Lists all local branches sorted by name. */
  listBranches(): Observable<Branch[]> {
    return this.refService.listBranches();
  }

  /** Deletes a local branch. Refuses to delete the currently checked-out branch. */
  deleteBranch(name: string): Observable<DeleteBranchResult> {
    return this.refService.deleteBranch(name);
  }

  /**
   * Returns the name of the current branch, or `undefined` if HEAD is detached.
   * Reads HEAD and parses symbolic refs like `ref: refs/heads/main`.
   */
  getCurrentBranch(): Observable<string | undefined> {
    return this.refService.getCurrentBranch();
  }

  /**
   * Switches the working tree and index to a branch or commit.
   *
   * - If `target` matches a branch name, HEAD becomes a symbolic ref to that branch.
   * - If `target` is a commit oid, HEAD becomes detached at that commit.
   */
  checkout(target: string): Observable<CheckoutResult> {
    return this.checkoutService.checkout(target);
  }

  /** Removes workspace files not present in the target tree and writes the tree files. */
  applyTreeToWorkspace$(
    treeEntries: Map<string, TreeEntryMap>,
  ): Observable<Map<string, TreeEntryMap>> {
    return this.checkoutService.applyTreeToWorkspace$(treeEntries);
  }

  /** Builds an index from a flattened tree. */
  buildIndexFromTree$(treeEntries: Map<string, TreeEntryMap>): Observable<Index> {
    return this.checkoutService.buildIndexFromTree$(treeEntries);
  }

  /** Creates a lightweight tag pointing at `target` (default HEAD). */
  createTag(name: string, options: RefCreateOptions = {}): Observable<CreateTagResult> {
    return this.refService.createTag(name, options);
  }

  /** Lists all lightweight tags sorted by name. */
  listTags(): Observable<Tag[]> {
    return this.refService.listTags();
  }

  /** Deletes a lightweight tag. */
  deleteTag(name: string): Observable<DeleteTagResult> {
    return this.refService.deleteTag(name);
  }

  /** Adds a remote repository. */
  addRemote(name: string, url: string): Observable<Remote> {
    return this.remoteService.addRemote(name, url);
  }

  /** Removes a remote repository and its configuration. */
  removeRemote(name: string): Observable<RemoveRemoteResult> {
    return this.remoteService.removeRemote(name);
  }

  /** Lists all configured remotes sorted by name. */
  listRemotes(): Observable<Remote[]> {
    return this.remoteService.listRemotes();
  }

  /** Performs a fast-forward merge of the current branch to `target`. */
  fastForwardMerge(target: string): Observable<MergeResult> {
    return fastForwardMerge(this, target);
  }

  /** Merges `target` into HEAD, fast-forwarding or creating a merge commit. */
  merge(target: string, options: MergeOptions): Observable<MergeResult> {
    return merge(this, target, options);
  }

  /** Fetches a ref from a remote and stores it as a remote-tracking ref. */
  fetch(remoteName: string, transport: Transport, options?: FetchOptions): Observable<FetchResult> {
    return fetch(this, remoteName, transport, options);
  }

  /** Pushes the current branch to a remote. */
  push(remoteName: string, transport: Transport, options?: FetchOptions): Observable<PushResult> {
    return push(this, remoteName, transport, options);
  }

  /** Fetches and then fast-forwards the current branch. */
  pull(
    remoteName: string,
    transport: Transport,
    options?: FetchOptions,
  ): Observable<{ readonly fetch: FetchResult; readonly merge: MergeResult }> {
    return pull(this, remoteName, transport, options);
  }

  /** Updates the workspace and index to match a commit's tree without moving HEAD. */
  applyCommit$(commitOid: Oid): Observable<void> {
    return this.checkoutService.applyCommit$(commitOid);
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
