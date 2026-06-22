import type { AddResult, IndexEntry, Oid, RemoveResult, RestoreResult } from "@slim-git/types";
import { combineLatest, concatMap, forkJoin, map, of, type Observable } from "rxjs";
import type { IndexStore } from "./index-store.js";
import type { ObjectStore } from "./object-store.js";
import type { WorkspaceBackend } from "./workspace-backend.js";
import { isIgnored, parseGitignore, type GitignorePattern } from "./gitignore.js";
import { Index } from "./index-model.js";

/** Creates an index entry from a workspace file. */
const createIndexEntry = (path: string, oid: Oid, content: Uint8Array): IndexEntry => {
  const now = new Date();
  const timestampSeconds = Math.floor(now.getTime() / 1000);

  return {
    path,
    oid,
    mode: 0o100644,
    stage: 0,
    fileSize: content.length,
    ctimeSeconds: timestampSeconds,
    ctimeNanos: 0,
    mtimeSeconds: timestampSeconds,
    mtimeNanos: 0,
    dev: 0,
    ino: 0,
    uid: 0,
    gid: 0,
    assumeValid: false,
    extended: false,
    skipWorktree: false,
    intentToAdd: false,
  };
};

/**
 * Staging operations: add, remove, and restore files.
 *
 * This service keeps staging logic out of the main `Repository` facade.
 */
export class StagingService {
  constructor(
    private readonly objectStore: ObjectStore,
    private readonly indexStore: IndexStore,
    private readonly workspace: WorkspaceBackend,
  ) {}

  /** Stages workspace files as blobs in the index, skipping ignored paths. */
  add(paths: readonly string[]): Observable<AddResult> {
    return combineLatest([this.indexStore.read(), this.readGitignore$()]).pipe(
      concatMap(([index, ignorePatterns]) => {
        const allowedPaths = paths.filter((path) => !isIgnored(path, ignorePatterns));
        return allowedPaths
          .reduce<Observable<Index>>(
            (index$, path) =>
              index$.pipe(
                concatMap((currentIndex) =>
                  this.workspace.readFile(path).pipe(
                    concatMap((content) =>
                      this.objectStore
                        .write("blob", content)
                        .pipe(map((blob) => ({ blob, content }))),
                    ),
                    map(({ blob, content }) =>
                      currentIndex.add(createIndexEntry(path, blob.oid, content)),
                    ),
                  ),
                ),
              ),
            of(index),
          )
          .pipe(
            concatMap((next) => this.indexStore.write(next)),
            map(() => ({ added: allowedPaths })),
          );
      }),
    );
  }

  /** Removes files from both the workspace and the index. */
  remove(paths: readonly string[]): Observable<RemoveResult> {
    return this.indexStore.read().pipe(
      concatMap((index) =>
        forkJoin(paths.map((path) => this.workspace.removeFile(path))).pipe(
          map(() => index.removeMany(paths)),
        ),
      ),
      concatMap((next) => this.indexStore.write(next)),
      map(() => ({ removed: paths })),
    );
  }

  /** Writes the indexed version of each path back into the workspace. */
  restore(paths: readonly string[]): Observable<RestoreResult> {
    return this.indexStore.read().pipe(
      concatMap((index) =>
        forkJoin(
          paths.map((path) => {
            const entry = index.get(path);
            if (entry === undefined) {
              return of(undefined);
            }
            return this.objectStore
              .read(entry.oid)
              .pipe(concatMap((object) => this.workspace.writeFile(path, object.content)));
          }),
        ),
      ),
      map(() => ({ restored: paths })),
    );
  }

  /** Reads `.gitignore` from the workspace and parses it into ordered rules. */
  private readGitignore$(): Observable<readonly GitignorePattern[]> {
    return this.workspace.exists(".gitignore").pipe(
      concatMap((exists) => {
        if (!exists) {
          return of("");
        }
        return this.workspace
          .readFile(".gitignore")
          .pipe(map((content) => new TextDecoder().decode(content)));
      }),
      map((content) => parseGitignore(content)),
    );
  }
}
