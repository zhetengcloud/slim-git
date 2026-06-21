import type { Oid, Repository } from "@slim-git/core";
import { concatMap, defaultIfEmpty, filter, first, map, of, type Observable, toArray } from "rxjs";

/**
 * Finds the best common ancestor (merge base) of two commits.
 *
 * Uses breadth-first traversal of each history. The first commit reachable from
 * `b` that is also reachable from `a` is returned. Returns `undefined` if the
 * histories do not share an ancestor.
 */
export const findMergeBase$ = (repo: Repository, a: Oid, b: Oid): Observable<Oid | undefined> => {
  if (a === b) {
    return of(a);
  }

  return collectAncestors$(repo, a).pipe(
    concatMap((ancestors) =>
      repo.log({ ref: b }).pipe(
        filter((commit) => ancestors.has(commit.oid)),
        map((commit) => commit.oid),
        defaultIfEmpty(undefined),
        first(),
      ),
    ),
  );
};

/** Collects every commit oid reachable from a starting commit. */
const collectAncestors$ = (repo: Repository, start: Oid): Observable<ReadonlySet<Oid>> =>
  repo.log({ ref: start }).pipe(
    map((commit) => commit.oid),
    toArray(),
    map((oids) => new Set(oids)),
  );
