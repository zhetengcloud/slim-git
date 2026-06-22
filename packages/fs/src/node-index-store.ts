import type { IndexStore } from "@slim-git/core";
import { Index } from "@slim-git/core";
import type { IndexWriteResult } from "@slim-git/types";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { catchError, concatMap, from, map, of, type Observable, throwError } from "rxjs";
import { decodeIndex, encodeIndex } from "./index-codec.js";
import { isNodeNotFoundError, writeFileEnsuringDir$ } from "./node-utils.js";

/**
 * Node.js filesystem implementation of `IndexStore` backed by `.git/index`.
 *
 * Uses the Git index v2 binary codec so the file is readable by canonical Git.
 */
export class NodeIndexStore implements IndexStore {
  constructor(private readonly gitDir: string) {}

  read(): Observable<Index> {
    return from(readFile(this.indexPath())).pipe(
      concatMap((buffer) => decodeIndex(new Uint8Array(buffer))),
      catchError((error) => {
        if (isNodeNotFoundError(error)) return of(Index.empty());
        return throwError(() => error);
      }),
    );
  }

  write(index: Index): Observable<IndexWriteResult> {
    const bytes = encodeIndex(index);
    return writeFileEnsuringDir$(this.indexPath(), bytes).pipe(
      map(() => ({ entries: index.paths.length })),
    );
  }

  private indexPath(): string {
    return join(this.gitDir, "index");
  }
}

