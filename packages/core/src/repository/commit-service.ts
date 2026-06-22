import type { Oid, Person } from "@slim-git/types";
import { combineLatest, concatMap, map, of, type Observable, throwError } from "rxjs";
import { CommitBuilder } from "@slim-git/core/commit-builder.js";
import { parseCommit$ } from "@slim-git/core/commit-parser.js";
import type { IndexStore } from "@slim-git/core/index-store.js";
import { Index } from "@slim-git/core/index-model.js";
import type { ObjectStore } from "@slim-git/core/object-store.js";
import { RefService } from "./ref-service.js";
import { TreeBuilder } from "@slim-git/core/tree-builder.js";

/** Options used when creating or amending a commit. */
export interface CommitOptions {
  readonly message: string;
  readonly author: Person;
  readonly committer?: Person;
}

/**
 * Commit creation and amendment.
 *
 * This service keeps commit-building logic out of the main `Repository` facade.
 */
export class CommitService {
  constructor(
    private readonly objectStore: ObjectStore,
    private readonly indexStore: IndexStore,
    private readonly refService: RefService,
  ) {}

  /**
   * Creates a commit from the current index, updates HEAD, and clears the index.
   *
   * Note: clearing the index after commit is the current slim-git behavior for the
   * memory backend; it will be revised to match canonical Git once persistence lands.
   */
  commit(options: CommitOptions): Observable<Oid> {
    return combineLatest([this.indexStore.read(), this.refService.resolveRef("HEAD")]).pipe(
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
    return this.refService.resolveRef("HEAD").pipe(
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
    return this.refService.readHead().pipe(
      concatMap((headValue) => {
        const branchRef = headValue?.startsWith("ref: ")
          ? headValue.slice("ref: ".length)
          : undefined;
        const targetRef$ = branchRef !== undefined ? of(branchRef) : of("HEAD");
        return targetRef$.pipe(
          concatMap((ref) => this.refService.writeRef(ref, commitOid)),
          concatMap(() => this.indexStore.write(Index.empty())),
          map(() => commitOid),
        );
      }),
    );
  }

  /** Builds a tree object from every entry in the index and returns its oid. */
  private buildTreeFromIndex$(index: Index): Observable<Oid> {
    const builder = index.toArray().reduce((tree, entry) => {
      return tree.insert(entry.path, entry.oid, entry.mode);
    }, new TreeBuilder());

    return builder.build(this.objectStore);
  }
}
