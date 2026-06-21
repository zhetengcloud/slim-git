import type { FetchResult, GitObject, MergeResult, Oid, PushResult } from "@slim-git/types";
import { NotFoundError } from "@slim-git/types";
import {
  combineLatest,
  concatMap,
  defaultIfEmpty,
  forkJoin,
  map,
  Observable,
  of,
  throwError,
} from "rxjs";
import type { Repository } from "./repository.js";
import { parseTreeEntries } from "./tree-utils.js";
import type { Transport } from "./transport.js";

/** Options for fetch/push/pull operations. */
export interface FetchOptions {
  /** Branch name to fetch/push/pull. Defaults to the current branch. */
  readonly ref?: string;
}

/** Fetches a ref from a remote transport and updates remote-tracking refs. */
export const fetch = (
  repo: Repository,
  remoteName: string,
  transport: Transport,
  options: FetchOptions = {},
): Observable<FetchResult> =>
  resolveTargetBranch$(repo, options.ref).pipe(
    concatMap((branchName) =>
      transport.discoverRefs().pipe(
        concatMap((remoteRefs) => {
          const remoteRef = `refs/heads/${branchName}`;
          const matchingRefs = remoteRefs.filter((ref) =>
            matchesRef(ref.name, branchName, remoteRef),
          );

          if (matchingRefs.length === 0) {
            return throwError(() => new NotFoundError(`ref ${branchName} on remote`));
          }

          const wants = matchingRefs.map((ref) => ref.oid);
          return transport.fetch(wants, []).pipe(
            concatMap((objects) => writeObjects$(repo, objects)),
            concatMap(() => updateRemoteTrackingRefs$(repo, remoteName, matchingRefs)),
            map(() => ({
              fetched: matchingRefs.map((ref) => ({ ref: ref.name, oid: ref.oid })),
            })),
          );
        }),
      ),
    ),
  );

/** Pushes the current branch to a remote transport. */
export const push = (
  repo: Repository,
  remoteName: string,
  transport: Transport,
  options: FetchOptions = {},
): Observable<PushResult> =>
  resolveTargetBranch$(repo, options.ref).pipe(
    concatMap((branchName) =>
      combineLatest([repo.resolveRef(`refs/heads/${branchName}`), transport.discoverReceiveRefs()]).pipe(
        concatMap(([localOid, remoteRefs]) => {
          if (localOid === undefined) {
            return throwError(() => new NotFoundError(`refs/heads/${branchName}`));
          }

          const remoteRef = `refs/heads/${branchName}`;
          const remoteMatch = remoteRefs.find((ref) => ref.name === remoteRef);
          const oldOid = remoteMatch?.oid ?? ("0000000000000000000000000000000000000000" as Oid);

          return collectReachableObjects$(repo, localOid).pipe(
            concatMap((objects) =>
              transport.push([{ ref: remoteRef, oldOid, newOid: localOid }], objects),
            ),
            concatMap((report) =>
              repo.refs
                .write(remoteTrackingRef(remoteName, remoteRef), localOid)
                .pipe(map(() => ({ pushed: report.accepted }))),
            ),
          );
        }),
      ),
    ),
  );

/** Pulls a ref from a remote and fast-forwards the current branch. */
export const pull = (
  repo: Repository,
  remoteName: string,
  transport: Transport,
  options: FetchOptions = {},
): Observable<{ readonly fetch: FetchResult; readonly merge: MergeResult }> =>
  fetch(repo, remoteName, transport, options).pipe(
    concatMap((fetchResult) => {
      const branchName =
        options.ref ?? fetchResult.fetched[0]?.ref.replace(/^refs\/(heads\/)?/, "") ?? "";
      const trackingRef = remoteTrackingRef(remoteName, `refs/heads/${branchName}`);
      return repo
        .fastForwardMerge(trackingRef)
        .pipe(map((merge) => ({ fetch: fetchResult, merge })));
    }),
  );

const resolveTargetBranch$ = (repo: Repository, explicitRef?: string): Observable<string> => {
  if (explicitRef !== undefined) {
    return of(explicitRef);
  }

  return repo
    .getCurrentBranch()
    .pipe(
      concatMap((branch) =>
        branch === undefined
          ? throwError(() => new Error("No current branch; specify a ref"))
          : of(branch),
      ),
    );
};

const matchesRef = (name: string, branchName: string, remoteRef: string): boolean =>
  name === remoteRef || name === `refs/heads/${branchName}` || name === branchName;

const remoteTrackingRef = (remoteName: string, refName: string): string => {
  if (refName.startsWith("refs/heads/")) {
    return `refs/remotes/${remoteName}/${refName.slice("refs/heads/".length)}`;
  }
  return `refs/remotes/${remoteName}/${refName}`;
};

const writeObjects$ = (repo: Repository, objects: readonly GitObject[]): Observable<void> =>
  forkJoin(objects.map((object) => repo.objectStore.write(object.type, object.content))).pipe(
    defaultIfEmpty([]),
    map(() => undefined),
  );

const updateRemoteTrackingRefs$ = (
  repo: Repository,
  remoteName: string,
  refs: ReadonlyArray<{ readonly name: string; readonly oid: Oid }>,
): Observable<void> =>
  forkJoin(
    refs.map((ref) => repo.refs.write(remoteTrackingRef(remoteName, ref.name), ref.oid)),
  ).pipe(
    defaultIfEmpty([]),
    map(() => undefined),
  );

/** Collects all objects reachable from a commit oid (commit, tree, blobs). */
const collectReachableObjects$ = (repo: Repository, oid: Oid): Observable<readonly GitObject[]> => {
  const collected = new Map<Oid, GitObject>();

  const visit = async (objectOid: Oid): Promise<void> => {
    if (collected.has(objectOid)) return;

    const object = await new Promise<GitObject>((resolve, reject) => {
      repo.objectStore.read(objectOid).subscribe({ next: resolve, error: reject });
    });
    collected.set(objectOid, object);

    if (object.type === "commit") {
      const text = new TextDecoder().decode(object.content);
      const parentMatches = text.match(/^parent ([0-9a-f]{40})$/gim);
      if (parentMatches !== null) {
        for (const match of parentMatches) {
          await visit(match.split(" ")[1]! as Oid);
        }
      }
      const treeMatch = text.match(/^tree ([0-9a-f]{40})$/im);
      if (treeMatch !== null) {
        await visit(treeMatch[1]! as Oid);
      }
    } else if (object.type === "tree") {
      for (const entry of parseTreeEntries(object.content).values()) {
        await visit(entry.oid);
      }
    }
  };

  return new Observable((subscriber) => {
    visit(oid)
      .then(() => {
        subscriber.next(Array.from(collected.values()));
        subscriber.complete();
      })
      .catch((error) => subscriber.error(error));
  });
};
