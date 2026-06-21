import type { RefStore } from "@slim-git/core";
import type { Ref, RefDeleteResult, RefWriteResult } from "@slim-git/types";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { catchError, concatMap, from, map, of, type Observable, throwError } from "rxjs";

/**
 * Node.js filesystem implementation of `RefStore`.
 *
 * Stores refs as files under `.git/refs/` and treats `.git/HEAD` as a special
 * symbolic ref. Ref values are read/written as plain text (oid or `ref: ...`).
 */
export class NodeRefStore implements RefStore {
  constructor(private readonly gitDir: string) {}

  read(ref: string): Observable<string | undefined> {
    const path = this.refPath(ref);
    return from(readFile(path, "utf-8")).pipe(
      map((text) => text.trim()),
      catchError((error) => {
        if (isNodeNotFoundError(error)) return of(undefined);
        return throwError(() => error);
      }),
    );
  }

  write(ref: string, target: string): Observable<RefWriteResult> {
    const path = this.refPath(ref);
    return from(mkdir(dirname(path), { recursive: true })).pipe(
      concatMap(() => from(writeFile(path, `${target}\n`))),
      map(() => ({ ref, target })),
    );
  }

  delete(ref: string): Observable<RefDeleteResult> {
    return from(rm(this.refPath(ref), { force: true })).pipe(map(() => ({ ref })));
  }

  list(prefix: string): Observable<Ref[]> {
    const refsDir = join(this.gitDir, "refs");
    return from(listRefFiles(this.gitDir, refsDir, prefix)).pipe(
      map((refs) => refs.sort((a, b) => a.name.localeCompare(b.name))),
    );
  }

  /** Maps a ref name to its filesystem path. */
  private refPath(ref: string): string {
    return ref === "HEAD" ? join(this.gitDir, "HEAD") : join(this.gitDir, ref);
  }
}

/** Checks whether an unknown value is a Node.js ENOENT error. */
const isNodeNotFoundError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

/**
 * Lists refs under `refsDir` matching `prefix`, returning full ref names
 * (e.g. `refs/heads/main`). Only scans the filesystem; packed-refs is not
 * supported in this slim implementation.
 */
const listRefFiles = async (gitDir: string, refsDir: string, prefix: string): Promise<Ref[]> => {
  const refs: Ref[] = [];

  for await (const entry of await readdir(refsDir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;

    const absolute = join(entry.parentPath ?? refsDir, entry.name);
    const name = toUnixPath(relative(gitDir, absolute));
    if (!name.startsWith(prefix)) continue;

    const target = (await readFile(absolute, "utf-8")).trim();
    refs.push({ name, target });
  }

  return refs;
};

/** Converts a platform path to a forward-slash string. */
const toUnixPath = (path: string): string => path.split(sep).join("/");
