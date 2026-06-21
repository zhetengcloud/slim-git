import type { IndexStore } from "@slim-git/core";
import { Index } from "@slim-git/core";
import type { IndexWriteResult } from "@slim-git/types";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { catchError, concatMap, from, map, of, type Observable, throwError } from "rxjs";
import { decodeIndex, encodeIndex } from "./index-codec.js";

/**
 * Node.js filesystem implementation of `IndexStore` backed by `.git/index`.
 *
 * Uses the Git index v2 binary codec so the file is readable by canonical Git.
 */
export class NodeIndexStore implements IndexStore {
  constructor(private readonly gitDir: string) {}

  read(): Observable<Index> {
    return from(readFile(this.indexPath())).pipe(
      map((buffer) => decodeIndex(new Uint8Array(buffer))),
      catchError((error) => {
        if (isNodeNotFoundError(error)) return of(Index.empty());
        return throwError(() => error);
      }),
    );
  }

  write(index: Index): Observable<IndexWriteResult> {
    const bytes = encodeIndex(index);
    return from(mkdir(dirname(this.indexPath()), { recursive: true })).pipe(
      concatMap(() => from(writeFile(this.indexPath(), bytes))),
      map(() => ({ entries: index.paths.length })),
    );
  }

  private indexPath(): string {
    return join(this.gitDir, "index");
  }
}

/** Checks whether an unknown value is a Node.js ENOENT error. */
const isNodeNotFoundError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
