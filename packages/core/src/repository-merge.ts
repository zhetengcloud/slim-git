import type { MergeResult, Oid, Person, RefWriteResult } from "@slim-git/types";
import { NotFoundError, UnsupportedError } from "@slim-git/types";
import {
  combineLatest,
  concatMap,
  defaultIfEmpty,
  filter,
  first,
  map,
  of,
  type Observable,
  throwError,
} from "rxjs";
import { CommitBuilder } from "./commit-builder.js";
import { findMergeBase$ } from "./merge-base.js";
import type { Repository } from "./repository/index.js";
import { flattenTree$ } from "./tree-utils.js";
import { mergeTrees$ } from "./tree-merge.js";

/** Options for creating a merge commit. */
export interface MergeOptions {
  /** Commit message. Defaults to "Merge branch '<target>'". */
  readonly message?: string;
  readonly author: Person;
  /** Defaults to `author`. */
  readonly committer?: Person;
  /** Label used in conflict markers. Defaults to "branch". */
  readonly targetLabel?: string;
}

/** Performs a fast-forward merge of the current branch to `target`. */
export const fastForwardMerge = (repo: Repository, target: string): Observable<MergeResult> =>
  combineLatest([repo.refs.read("HEAD"), repo.resolveRef(target)]).pipe(
    concatMap(([headValue, targetOid]) => {
      if (headValue === undefined) {
        return throwError(() => new NotFoundError("HEAD"));
      }
      if (targetOid === undefined) {
        return throwError(() => new NotFoundError(target));
      }

      const headRef = headValue;
      const newOid = targetOid;

      return resolveHeadOid$(repo, headRef).pipe(
        concatMap((headOid) => {
          if (headOid === undefined) {
            return throwError(() => new NotFoundError(headRef));
          }
          if (headOid === newOid) {
            return of({ merged: true as const, commitOid: newOid });
          }
          return isAncestor$(repo, headOid, newOid).pipe(
            concatMap((isAncestor) => {
              if (!isAncestor) {
                return throwError(
                  () => new UnsupportedError("Cannot fast-forward: branches have diverged"),
                );
              }
              return repo.applyCommit$(newOid).pipe(
                concatMap(() => updateHead$(repo, headRef, newOid)),
                map(() => ({ merged: true as const, commitOid: newOid })),
              );
            }),
          );
        }),
      );
    }),
  );

/**
 * Merges `target` into HEAD.
 *
 * - Fast-forwards when possible.
 * - Performs a three-way merge otherwise.
 * - On conflicts, writes conflict-marker files and returns `merged: false`.
 * - On clean merge, creates a merge commit and moves HEAD.
 */
export const merge = (
  repo: Repository,
  target: string,
  options: MergeOptions,
): Observable<MergeResult> =>
  combineLatest([repo.refs.read("HEAD"), repo.resolveRef(target)]).pipe(
    concatMap(([headValue, targetOid]) => {
      if (headValue === undefined) {
        return throwError(() => new NotFoundError("HEAD"));
      }
      if (targetOid === undefined) {
        return throwError(() => new NotFoundError(target));
      }

      const headRef = headValue;

      return resolveHeadOid$(repo, headRef).pipe(
        concatMap((headOid) => {
          if (headOid === undefined) {
            return throwError(() => new NotFoundError(headRef));
          }

          return tryFastForwardMerge$(repo, headRef, headOid, targetOid).pipe(
            concatMap((fastForwardResult) => {
              if (fastForwardResult !== undefined) {
                return of(fastForwardResult);
              }

              return performThreeWayMerge$(repo, headRef, headOid, targetOid, target, options);
            }),
          );
        }),
      );
    }),
  );

const resolveHeadOid$ = (repo: Repository, headRef: string): Observable<Oid | undefined> =>
  headRef.startsWith("ref: ") ? repo.resolveRef(headRef.slice("ref: ".length)) : of(headRef as Oid);

const tryFastForwardMerge$ = (
  repo: Repository,
  headRef: string,
  headOid: Oid,
  targetOid: Oid,
): Observable<MergeResult | undefined> =>
  headOid === targetOid
    ? of({ merged: true as const, commitOid: targetOid })
    : isAncestor$(repo, headOid, targetOid).pipe(
        concatMap((isAncestor) => {
          if (!isAncestor) {
            return of(undefined);
          }
          return repo.applyCommit$(targetOid).pipe(
            concatMap(() => updateHead$(repo, headRef, targetOid)),
            map(() => ({ merged: true as const, commitOid: targetOid })),
          );
        }),
      );

const performThreeWayMerge$ = (
  repo: Repository,
  headRef: string,
  headOid: Oid,
  targetOid: Oid,
  targetName: string,
  options: MergeOptions,
): Observable<MergeResult> =>
  findMergeBase$(repo, headOid, targetOid).pipe(
    concatMap((baseOid) => {
      if (baseOid === undefined) {
        return throwError(() => new UnsupportedError("Cannot merge: histories are unrelated"));
      }

      return combineLatest([
        repo.readCommitTree$(baseOid),
        repo.readCommitTree$(headOid),
        repo.readCommitTree$(targetOid),
      ]).pipe(
        concatMap(([baseTree, headTree, targetTree]) =>
          mergeTrees$(
            repo.objectStore,
            baseTree,
            headTree,
            targetTree,
            options.targetLabel ?? targetName,
          ).pipe(
            concatMap((treeMerge) =>
              applyTree$(repo, treeMerge.treeOid).pipe(
                concatMap(() => {
                  if (treeMerge.conflicts.length > 0) {
                    return of({ merged: false as const, conflicts: treeMerge.conflicts });
                  }

                  const message = options.message ?? `Merge branch '${targetName}'`;
                  const committer = options.committer ?? options.author;
                  return createMergeCommit$(
                    repo,
                    headOid,
                    targetOid,
                    treeMerge.treeOid,
                    message,
                    options.author,
                    committer,
                  ).pipe(
                    concatMap((mergeCommitOid) =>
                      updateHead$(repo, headRef, mergeCommitOid).pipe(map(() => mergeCommitOid)),
                    ),
                    map((commitOid) => ({ merged: true as const, commitOid })),
                  );
                }),
              ),
            ),
          ),
        ),
      );
    }),
  );

const applyTree$ = (repo: Repository, treeOid: Oid): Observable<void> =>
  flattenTree$(repo.objectStore, treeOid).pipe(
    concatMap((entries) => repo.applyTreeToWorkspace$(entries)),
    concatMap((entries) => repo.buildIndexFromTree$(entries)),
    concatMap((index) => repo.indexStore.write(index)),
    map(() => undefined),
  );

const createMergeCommit$ = (
  repo: Repository,
  headOid: Oid,
  targetOid: Oid,
  treeOid: Oid,
  message: string,
  author: Person,
  committer: Person,
): Observable<Oid> =>
  new CommitBuilder()
    .tree(treeOid)
    .parent(headOid)
    .parent(targetOid)
    .author(author)
    .committer(committer)
    .message(message)
    .build(repo.objectStore);

const updateHead$ = (repo: Repository, headRef: string, oid: Oid): Observable<RefWriteResult> =>
  headRef.startsWith("ref: ")
    ? repo.refs.write(headRef.slice("ref: ".length), oid)
    : repo.refs.write("HEAD", oid);

/** Checks whether `ancestor` is an ancestor of `descendant` (or the same commit). */
const isAncestor$ = (repo: Repository, ancestor: Oid, descendant: Oid): Observable<boolean> => {
  if (ancestor === descendant) {
    return of(true);
  }

  return repo.log({ ref: descendant }).pipe(
    map((commit) => commit.oid === ancestor),
    filter((found) => found),
    defaultIfEmpty(false),
    first(),
  );
};
