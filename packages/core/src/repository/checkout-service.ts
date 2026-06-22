import type { CheckoutResult, Oid } from "@slim-git/types";
import { NotFoundError } from "@slim-git/types";
import { concatMap, defaultIfEmpty, forkJoin, map, of, type Observable, throwError } from "rxjs";
import { createIndexEntry } from "@slim-git/core/index-entry-utils.js";
import { Index } from "@slim-git/core/index-model.js";
import type { IndexStore } from "@slim-git/core/index-store.js";
import type { ObjectStore } from "@slim-git/core/object-store.js";
import type { RefStore } from "@slim-git/core/ref-store.js";
import type { TreeEntryMap } from "@slim-git/core/tree-utils.js";
import { flattenTree$, readCommitTree$ } from "@slim-git/core/tree-utils.js";
import type { WorkspaceBackend } from "@slim-git/core/workspace-backend.js";

/**
 * Working-tree checkout: switching branches, applying trees, and rebuilding the index.
 *
 * This service keeps checkout logic out of the main `Repository` facade.
 */
export class CheckoutService {
  constructor(
    private readonly objectStore: ObjectStore,
    private readonly refs: RefStore,
    private readonly indexStore: IndexStore,
    private readonly workspace: WorkspaceBackend,
  ) {}

  /**
   * Switches the working tree and index to a branch or commit.
   *
   * - If `target` matches a branch name, HEAD becomes a symbolic ref to that branch.
   * - If `target` is a commit oid, HEAD becomes detached at that commit.
   */
  checkout(target: string): Observable<CheckoutResult> {
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
        this.applyCommit$(commitOid).pipe(
          concatMap(() => this.refs.write("HEAD", headValue)),
          map(() => ({
            commitOid,
            branch: headValue.startsWith("ref: ")
              ? headValue.slice("ref: refs/heads/".length)
              : undefined,
          })),
        ),
      ),
    );
  }

  /** Updates the workspace and index to match a commit's tree without moving HEAD. */
  applyCommit$(commitOid: Oid): Observable<void> {
    return readCommitTree$(this.objectStore, commitOid).pipe(
      concatMap((treeOid) => flattenTree$(this.objectStore, treeOid)),
      concatMap((treeEntries) => this.applyTreeToWorkspace$(treeEntries)),
      concatMap((treeEntries) => this.buildIndexFromTree$(treeEntries)),
      concatMap((index) => this.indexStore.write(index)),
      map(() => undefined),
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
}
