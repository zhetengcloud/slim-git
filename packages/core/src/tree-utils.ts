import type { Oid } from "@slim-git/types";
import { concatMap, forkJoin, map, of, type Observable } from "rxjs";
import { bytesToHex } from "./bytes.js";
import type { ObjectStore } from "./object-store.js";

/** Internal representation of a parsed tree entry used for HEAD comparisons. */
export interface TreeEntryMap {
  readonly oid: Oid;
  readonly mode: number;
}

/**
 * Parses the raw bytes of a Git tree object into a map of name → entry.
 * Tree format: `<mode> <name>\0<20-byte oid>` repeated for each entry.
 */
export const parseTreeEntries = (content: Uint8Array): Map<string, TreeEntryMap> => {
  const entries = new Map<string, TreeEntryMap>();
  let position = 0;

  while (position < content.length) {
    const spaceIndex = content.indexOf(0x20, position);
    const nullIndex = content.indexOf(0x00, spaceIndex + 1);
    if (spaceIndex === -1 || nullIndex === -1) break;

    const modeText = new TextDecoder().decode(content.slice(position, spaceIndex));
    const mode = Number.parseInt(modeText, 8);
    const name = new TextDecoder().decode(content.slice(spaceIndex + 1, nullIndex));
    const oidStart = nullIndex + 1;
    const oidEnd = oidStart + 20;
    const oidBytes = content.slice(oidStart, oidEnd);
    const oid = bytesToHex(oidBytes) as Oid;

    entries.set(name, { oid, mode });
    position = oidEnd;
  }

  return entries;
};

/**
 * Recursively walks a tree to find the entry at the given path segments.
 * Returns undefined if any segment is missing.
 */
export const findInTree$ = (
  store: ObjectStore,
  treeOid: Oid,
  segments: readonly string[],
): Observable<TreeEntryMap | undefined> => {
  if (segments.length === 0) {
    return of(undefined);
  }

  return store.read(treeOid).pipe(
    map((tree) => parseTreeEntries(tree.content)),
    concatMap((entries) => {
      const entry = entries.get(segments[0]!);
      if (entry === undefined) {
        return of(undefined);
      }
      if (segments.length === 1) {
        return of(entry);
      }
      return findInTree$(store, entry.oid, segments.slice(1));
    }),
  );
};

/**
 * Recursively flattens a tree into a map of path → { oid, mode } for all blobs.
 * Directory paths are expanded; the returned map only contains files.
 */
export const flattenTree$ = (
  store: ObjectStore,
  treeOid: Oid,
  prefix = "",
): Observable<Map<string, TreeEntryMap>> => {
  return store.read(treeOid).pipe(
    map((tree) => parseTreeEntries(tree.content)),
    concatMap((entries) => {
      const childTasks = Array.from(entries).map(([name, entry]) => {
        const path = prefix ? `${prefix}/${name}` : name;
        if (entry.mode === 0o040000) {
          return flattenTree$(store, entry.oid, path).pipe(
            map((childEntries) => Array.from(childEntries) as [string, TreeEntryMap][]),
          );
        }
        return of([[path, entry]] as [string, TreeEntryMap][]);
      });

      return childTasks.length === 0
        ? of(new Map<string, TreeEntryMap>())
        : forkJoin(childTasks).pipe(map((groups) => new Map(groups.flat())));
    }),
  );
};
