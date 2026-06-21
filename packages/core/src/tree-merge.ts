import type { MergeConflict, Oid } from "@slim-git/types";
import { combineLatest, concatMap, defaultIfEmpty, forkJoin, map, of, type Observable } from "rxjs";
import type { ObjectStore } from "./object-store.js";
import { TreeBuilder } from "./tree-builder.js";
import { flattenTree$, type TreeEntryMap } from "./tree-utils.js";

/** Result of merging three trees (base, HEAD, target). */
export interface TreeMergeResult {
  readonly treeOid: Oid;
  readonly conflicts: readonly MergeConflict[];
}

const DefaultFileMode = 0o100644;

/**
 * Performs a three-way tree merge.
 *
 * - Paths changed on only one side keep that change.
 * - Paths changed on both sides identically keep the shared result.
 * - Paths changed on both sides differently become conflicts with Git-style
 *   conflict markers written to a new blob.
 */
export const mergeTrees$ = (
  store: ObjectStore,
  baseOid: Oid,
  headOid: Oid,
  targetOid: Oid,
  targetLabel = "branch",
): Observable<TreeMergeResult> =>
  combineLatest([
    flattenTree$(store, baseOid),
    flattenTree$(store, headOid),
    flattenTree$(store, targetOid),
  ]).pipe(
    concatMap(([base, head, target]) => {
      const paths = new Set([...base.keys(), ...head.keys(), ...target.keys()]);

      return forkJoin(
        Array.from(paths).map((path) =>
          mergePath$(store, path, base.get(path), head.get(path), target.get(path), targetLabel),
        ),
      ).pipe(
        defaultIfEmpty([]),
        concatMap((outcomes) => {
          const builder = outcomes.reduce((tree, outcome) => {
            return tree.insert(outcome.path, outcome.entry.oid, outcome.entry.mode);
          }, new TreeBuilder());

          const conflicts = outcomes
            .map((outcome) => outcome.conflict)
            .filter((conflict): conflict is MergeConflict => conflict !== undefined);

          return builder.build(store).pipe(map((treeOid) => ({ treeOid, conflicts })));
        }),
      );
    }),
  );

interface PathMergeOutcome {
  readonly path: string;
  readonly entry: TreeEntryMap;
  readonly conflict?: MergeConflict;
}

const mergePath$ = (
  store: ObjectStore,
  path: string,
  base: TreeEntryMap | undefined,
  head: TreeEntryMap | undefined,
  target: TreeEntryMap | undefined,
  targetLabel: string,
): Observable<PathMergeOutcome> => {
  const headChanged = !entriesEqual(base, head);
  const targetChanged = !entriesEqual(base, target);

  if (!headChanged && !targetChanged) {
    return of({ path, entry: head ?? target ?? base! });
  }
  if (!headChanged) {
    return of({ path, entry: target! });
  }
  if (!targetChanged) {
    return of({ path, entry: head! });
  }

  return conflictOutcome$(store, path, head, target, targetLabel);
};

const entriesEqual = (a: TreeEntryMap | undefined, b: TreeEntryMap | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && a.oid === b.oid && a.mode === b.mode);

const conflictOutcome$ = (
  store: ObjectStore,
  path: string,
  head: TreeEntryMap | undefined,
  target: TreeEntryMap | undefined,
  targetLabel: string,
): Observable<PathMergeOutcome> =>
  combineLatest([readBlobContent$(store, head?.oid), readBlobContent$(store, target?.oid)]).pipe(
    concatMap(([headContent, targetContent]) => {
      const conflictContent = buildConflictContent(headContent, targetContent, targetLabel);
      return store.write("blob", conflictContent).pipe(
        map((object) => ({
          path,
          entry: {
            oid: object.oid,
            mode: head?.mode ?? target?.mode ?? DefaultFileMode,
          },
          conflict: { path, content: conflictContent },
        })),
      );
    }),
  );

const readBlobContent$ = (store: ObjectStore, oid: Oid | undefined): Observable<Uint8Array> => {
  if (oid === undefined) {
    return of(new Uint8Array());
  }
  return store.read(oid).pipe(map((object) => object.content));
};

const buildConflictContent = (
  headContent: Uint8Array,
  targetContent: Uint8Array,
  targetLabel: string,
): Uint8Array => {
  const encoder = new TextEncoder();
  const headText = new TextDecoder().decode(headContent);
  const targetText = new TextDecoder().decode(targetContent);

  const marker = `<<<<<<< HEAD\n${headText}=======\n${targetText}>>>>>>> ${targetLabel}\n`;
  return encoder.encode(marker);
};
