import { parseTreeEntries, type GitObject, type Oid, type StorageBackend } from "@slim-git/core";
import type { DiscoveredRef, PushCommand, PushReport, Transport } from "@slim-git/core";
import {
  concatMap,
  defaultIfEmpty,
  distinct,
  expand,
  forkJoin,
  from,
  map,
  of,
  type Observable,
  tap,
  toArray,
} from "rxjs";

/**
 * In-memory transport for testing fetch/push/pull without network or packfiles.
 *
 * Connects two storage backends directly: the local repo and a remote "server"
 * backend that holds the canonical objects and refs.
 */
export class MemoryTransport implements Transport {
  readonly name = "memory-transport";

  constructor(
    private readonly remoteRefs: Map<string, string>,
    private readonly remoteObjects: StorageBackend,
  ) {}

  discoverRefs(): Observable<readonly DiscoveredRef[]> {
    return this.discoverReceiveRefs();
  }

  discoverReceiveRefs(): Observable<readonly DiscoveredRef[]> {
    const refs: DiscoveredRef[] = Array.from(this.remoteRefs.entries())
      .map(([name, oid]) => ({ name, oid: oid as Oid }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return of(refs);
  }

  /** Recursively walks the remote object graph from the wanted oids. */
  fetch(wants: readonly Oid[]): Observable<readonly GitObject[]> {
    const cache = new Map<Oid, GitObject>();

    const readObject$ = (oid: Oid): Observable<GitObject> => {
      const cached = cache.get(oid);
      if (cached !== undefined) {
        return of(cached);
      }
      return this.remoteObjects.readObject(oid).pipe(tap((object) => cache.set(oid, object)));
    };

    return from(wants).pipe(
      expand((oid) => readObject$(oid).pipe(concatMap((object) => from(childOids(object))))),
      distinct(),
      concatMap((oid) => readObject$(oid)),
      toArray(),
      map((objects) => objects as readonly GitObject[]),
    );
  }

  push(commands: readonly PushCommand[], objects: readonly GitObject[]): Observable<PushReport> {
    return forkJoin(objects.map((object) => this.remoteObjects.writeObject(object))).pipe(
      defaultIfEmpty([]),
      map(() => {
        const accepted = commands.map(({ ref, newOid }) => {
          this.remoteRefs.set(ref, newOid);
          return { ref, oid: newOid, accepted: true };
        });
        return { accepted };
      }),
    );
  }
}

/** Returns the oids referenced by a Git object (parents/tree for commits, entries for trees). */
const childOids = (object: GitObject): readonly Oid[] => {
  if (object.type === "commit") {
    const text = new TextDecoder().decode(object.content);
    const parents = [...text.matchAll(/^parent ([0-9a-f]{40})$/gim)].map(
      (match) => match[1]! as Oid,
    );
    const tree = text.match(/^tree ([0-9a-f]{40})$/im)?.[1] as Oid | undefined;
    return tree === undefined ? parents : [...parents, tree];
  }

  if (object.type === "tree") {
    return Array.from(parseTreeEntries(object.content).values()).map((entry) => entry.oid);
  }

  return [];
};
