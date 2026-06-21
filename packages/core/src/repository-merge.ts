import type { MergeResult, Oid } from "@slim-git/types";
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
import type { Repository } from "./repository.js";

/** Performs a fast-forward merge of the current branch to `target`. */
export const fastForwardMerge = (repo: Repository, target: string): Observable<MergeResult> =>
  combineLatest([repo.refs.read("HEAD"), repo.resolveRef(target)]).pipe(
    concatMap(([headValue, targetOid]): Observable<MergeResult> => {
      if (headValue === undefined) {
        return throwError(() => new NotFoundError("HEAD")) as Observable<MergeResult>;
      }
      if (targetOid === undefined) {
        return throwError(() => new NotFoundError(target)) as Observable<MergeResult>;
      }

      const headRef = headValue;
      const newOid = targetOid;

      const headOid$ = (
        headRef.startsWith("ref: ") ? repo.resolveRef(headRef.slice("ref: ".length)) : of(headRef)
      ) as Observable<string | undefined>;

      return headOid$.pipe(
        concatMap((headOid): Observable<MergeResult> => {
          if (headOid === undefined) {
            return throwError(() => new NotFoundError(headRef)) as Observable<MergeResult>;
          }
          const currentOid = headOid;
          if (currentOid === newOid) {
            return of({ merged: true as const, commitOid: newOid as Oid });
          }
          return isAncestor$(repo, currentOid, newOid).pipe(
            concatMap((isAncestor): Observable<MergeResult> => {
              if (!isAncestor) {
                return throwError(
                  () => new UnsupportedError("Cannot fast-forward: branches have diverged"),
                ) as Observable<MergeResult>;
              }
              return repo.applyCommit$(newOid as Oid).pipe(
                concatMap((): Observable<MergeResult> => {
                  const headUpdate$ = headRef.startsWith("ref: ")
                    ? repo.refs.write(headRef.slice("ref: ".length), newOid)
                    : repo.refs.write("HEAD", newOid);
                  return headUpdate$.pipe(
                    map(() => ({ merged: true as const, commitOid: newOid as Oid })),
                  );
                }),
              );
            }),
          );
        }),
      );
    }),
  );

/** Checks whether `ancestor` is an ancestor of `descendant` (or the same commit). */
const isAncestor$ = (
  repo: Repository,
  ancestor: string,
  descendant: string,
): Observable<boolean> => {
  if (ancestor === descendant) {
    return of(true);
  }

  return repo.log({ ref: descendant as Oid }).pipe(
    map((commit) => commit.oid === ancestor),
    filter((found) => found),
    defaultIfEmpty(false),
    first(),
  );
};
