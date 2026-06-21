import type { GitObject, Oid, StorageBackend } from "@slim-git/core";
import type { DiscoveredRef, PushCommand, PushReport, Transport } from "@slim-git/core";
import { Observable, of } from "rxjs";

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
    const refs: DiscoveredRef[] = Array.from(this.remoteRefs.entries())
      .map(([name, oid]) => ({ name, oid: oid as Oid }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return of(refs);
  }

  fetch(wants: readonly Oid[]): Observable<readonly GitObject[]> {
    const fetched: GitObject[] = [];
    const visited = new Set<Oid>();

    const visit = async (oid: Oid): Promise<void> => {
      if (visited.has(oid)) return;
      visited.add(oid);

      const object = await new Promise<GitObject>((resolve, reject) => {
        this.remoteObjects.readObject(oid).subscribe({ next: resolve, error: reject });
      });
      fetched.push(object);

      if (object.type === "commit") {
        const text = new TextDecoder().decode(object.content);
        const parentMatches = text.match(/^parent ([0-9a-f]{40})$/gim);
        if (parentMatches !== null) {
          for (const match of parentMatches) {
            const parentOid = match.split(" ")[1]! as Oid;
            await visit(parentOid);
          }
        }
        const treeMatch = text.match(/^tree ([0-9a-f]{40})$/im);
        if (treeMatch !== null) {
          const treeOid = treeMatch[1]! as Oid;
          await visit(treeOid);
        }
      } else if (object.type === "tree") {
        const entries = parseTreeEntries(object.content);
        for (const entry of entries.values()) {
          await visit(entry.oid);
        }
      }
    };

    return new Observable((subscriber) => {
      Promise.all(wants.map((oid) => visit(oid)))
        .then(() => {
          subscriber.next(fetched);
          subscriber.complete();
        })
        .catch((error) => subscriber.error(error));
    });
  }

  push(commands: readonly PushCommand[], objects: readonly GitObject[]): Observable<PushReport> {
    for (const object of objects) {
      this.remoteObjects.writeObject(object).subscribe();
    }

    const accepted = commands.map(({ ref, newOid }) => {
      this.remoteRefs.set(ref, newOid);
      return { ref, oid: newOid, accepted: true };
    });

    return of({ accepted });
  }
}

const parseTreeEntries = (
  content: Uint8Array,
): Map<string, { readonly oid: Oid; readonly mode: number }> => {
  const entries = new Map<string, { readonly oid: Oid; readonly mode: number }>();
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
    const oid = Array.from(oidBytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("") as Oid;

    entries.set(name, { oid, mode });
    position = oidEnd;
  }

  return entries;
};
