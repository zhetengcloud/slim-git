import type { Oid, Status } from "@slim-git/types";
import { combineLatest, concatMap, forkJoin, map, of, type Observable } from "rxjs";
import type { IndexStore } from "./index-store.js";
import type { ObjectStore } from "./object-store.js";
import { RefService } from "./ref-service.js";
import { findInTree$, readCommitTree$ } from "./tree-utils.js";
import type { WorkspaceBackend } from "./workspace-backend.js";
import { isIgnored, parseGitignore, type GitignorePattern } from "./gitignore.js";
import { Index } from "./index-model.js";

/**
 * Computes the repository status by comparing the workspace, index, and HEAD.
 *
 * This service keeps status logic out of the main `Repository` facade.
 */
export class StatusService {
  constructor(
    private readonly objectStore: ObjectStore,
    private readonly indexStore: IndexStore,
    private readonly workspace: WorkspaceBackend,
    private readonly refService: RefService,
  ) {}

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
      this.readGitignore$(),
    ]).pipe(
      concatMap(([index, workspaceFiles, headTree, ignorePatterns]) =>
        this.computeStaged$(index, headTree).pipe(
          concatMap((staged) =>
            this.computeTrackedChanges$(index).pipe(map((changes) => ({ staged, ...changes }))),
          ),
          map(({ staged, modified, deleted }) => {
            const tracked = new Set(index.paths);
            const untracked = workspaceFiles.filter(
              (path) => !tracked.has(path) && !isIgnored(path, ignorePatterns),
            );
            return { staged, modified, deleted, untracked };
          }),
        ),
      ),
    );
  }

  /** Reads HEAD and returns the tree oid of the commit it points to, if any. */
  private readHeadTree$(): Observable<Oid | undefined> {
    return this.refService.resolveRef("HEAD").pipe(
      concatMap((head) => {
        if (head === undefined) {
          return of(undefined);
        }
        return readCommitTree$(this.objectStore, head);
      }),
    );
  }

  /** Reads `.gitignore` from the workspace and parses it into ordered rules. */
  private readGitignore$(): Observable<readonly GitignorePattern[]> {
    return this.workspace.exists(".gitignore").pipe(
      concatMap((exists) => {
        if (!exists) {
          return of("");
        }
        return this.workspace
          .readFile(".gitignore")
          .pipe(map((content) => new TextDecoder().decode(content)));
      }),
      map((content) => parseGitignore(content)),
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
}
