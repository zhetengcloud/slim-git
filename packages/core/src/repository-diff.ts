import type { Diff, FileDiff } from "@slim-git/types";
import { NotFoundError } from "@slim-git/types";
import {
  combineLatest,
  concatMap,
  defaultIfEmpty,
  filter,
  forkJoin,
  from,
  map,
  of,
  type Observable,
  throwError,
  toArray,
} from "rxjs";
import type { Index } from "./index-model.js";
import type { TreeEntryMap } from "./tree-utils.js";
import { flattenTree$ } from "./tree-utils.js";
import { unifiedDiff } from "./diff.js";
import type { Repository } from "./repository/index.js";

/** Default file mode used for regular files staged into the index. */
const DefaultFileMode = 0o100644;

/** Computes a diff between the index and the working tree. */
export const diffWorktreeIndex = (repo: Repository): Observable<Diff> =>
  combineLatest([resolveTreeMap$(repo, "index"), resolveTreeMap$(repo, "worktree")]).pipe(
    concatMap(([index, worktree]) => diffTreeMaps$(repo, index, worktree)),
    toArray(),
    map((files) => ({ files })),
  );

/** Computes a diff between HEAD and the index. */
export const diffIndexHead = (repo: Repository): Observable<Diff> =>
  combineLatest([resolveTreeMap$(repo, "head"), resolveTreeMap$(repo, "index")]).pipe(
    concatMap(([head, index]) => diffTreeMaps$(repo, head, index)),
    toArray(),
    map((files) => ({ files })),
  );

/** Computes a diff between the given ref, branch, or oid and HEAD. */
export const diffHeadRef = (repo: Repository, ref: string): Observable<Diff> =>
  combineLatest([resolveTreeMap$(repo, ref), resolveTreeMap$(repo, "head")]).pipe(
    concatMap(([other, head]) => diffTreeMaps$(repo, other, head)),
    toArray(),
    map((files) => ({ files })),
  );

/**
 * Resolves a tree source to a flattened map of path → { oid, mode }.
 * Sources can be "worktree", "index", "head", or any ref/branch/oid string.
 */
const resolveTreeMap$ = (
  repo: Repository,
  source: "worktree" | "index" | "head" | string,
): Observable<Map<string, TreeEntryMap>> => {
  if (source === "worktree") {
    return flattenWorktree$(repo);
  }

  if (source === "index") {
    return repo.indexStore.read().pipe(map((index) => indexToTreeMap(index)));
  }

  const oid$ = source === "head" ? repo.resolveRef("HEAD") : repo.resolveRef(source);
  return oid$.pipe(
    concatMap((oid) => {
      if (oid === undefined) {
        return throwError(() => new NotFoundError(source));
      }
      return repo
        .readCommitTree$(oid)
        .pipe(concatMap((treeOid) => flattenTree$(repo.objectStore, treeOid)));
    }),
  );
};

/** Builds a flattened map from the current workspace files. */
const flattenWorktree$ = (repo: Repository): Observable<Map<string, TreeEntryMap>> =>
  repo.workspace.listFiles().pipe(
    concatMap((files) =>
      forkJoin(files.map((path) => hashWorktreeFile$(repo, path))).pipe(defaultIfEmpty([])),
    ),
    map((entries) => new Map(entries)),
  );

/** Reads a workspace file and persists it as a blob so it has an oid. */
const hashWorktreeFile$ = (repo: Repository, path: string): Observable<[string, TreeEntryMap]> =>
  repo.workspace.readFile(path).pipe(
    concatMap((content) => repo.objectStore.write("blob", content)),
    map((blob) => [path, { oid: blob.oid, mode: DefaultFileMode }]),
  );

/** Converts an index into a flattened path → { oid, mode } map. */
const indexToTreeMap = (index: Index): Map<string, TreeEntryMap> =>
  new Map(index.toArray().map((entry) => [entry.path, { oid: entry.oid, mode: entry.mode }]));

/** Compares an old tree map to a new tree map and emits one FileDiff at a time. */
const diffTreeMaps$ = (
  repo: Repository,
  oldMap: Map<string, TreeEntryMap>,
  newMap: Map<string, TreeEntryMap>,
): Observable<FileDiff> => {
  const paths = Array.from(new Set([...oldMap.keys(), ...newMap.keys()])).sort();

  return from(paths).pipe(
    concatMap((path) => {
      const oldEntry = oldMap.get(path);
      const newEntry = newMap.get(path);

      if (oldEntry === undefined) {
        return of({ path, status: "added" as const, hunks: [] });
      }

      if (newEntry === undefined) {
        return of({ path, status: "deleted" as const, hunks: [] });
      }

      if (oldEntry.oid === newEntry.oid) {
        return of({ path, status: "unchanged" as const, hunks: [] });
      }

      return combineLatest([
        repo.objectStore.read(oldEntry.oid),
        repo.objectStore.read(newEntry.oid),
      ]).pipe(
        map(([oldObject, newObject]) => ({
          path,
          status: "modified" as const,
          hunks: unifiedDiff(oldObject.content, newObject.content),
        })),
      );
    }),
    filter((file) => file.status !== "unchanged"),
  );
};
