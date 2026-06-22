import {
  buildObjectBytes,
  concatChunks,
  parseObjectBytes,
  type StorageBackend,
} from "@slim-git/core";
import { NotFoundError } from "@slim-git/types";
import type { GitObject, Oid } from "@slim-git/types";
import { createInflate, createDeflate } from "node:zlib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { catchError, concatMap, from, map, Observable, throwError } from "rxjs";
import { fileExists, isNodeNotFoundError, writeFileEnsuringDir$ } from "./node-utils.js";

/**
 * Node.js filesystem implementation of `StorageBackend` using Git's loose-object
 * layout: `.git/objects/xx/xxxxxxxx...`.
 *
 * Objects are stored zlib-deflated with the canonical `<type> <size>\0<content>`
 * header, matching canonical Git's loose-object format.
 */
export class NodeStorageBackend implements StorageBackend {
  readonly name = "node-storage";

  constructor(private readonly gitDir: string) {}

  readObject(oid: Oid): Observable<GitObject> {
    return from(readFile(this.objectPath(oid))).pipe(
      concatMap((buffer) => inflateBytes$(new Uint8Array(buffer))),
      map((raw) => {
        const { type, content } = parseObjectBytes(raw);
        return { type, content, oid };
      }),
      catchError((error) => {
        if (isNodeNotFoundError(error)) {
          return throwError(() => new NotFoundError(`object ${oid}`));
        }
        return throwError(() => error);
      }),
    );
  }

  writeObject(object: GitObject): Observable<GitObject> {
    const bytes = buildObjectBytes(object.type, object.content);
    return deflateBytes$(bytes).pipe(
      concatMap((compressed) =>
        writeFileEnsuringDir$(this.objectPath(object.oid), compressed),
      ),
      map(() => object),
    );
  }

  exists(oid: Oid): Observable<boolean> {
    return from(fileExists(this.objectPath(oid)));
  }

  /** Maps an oid to its loose-object filesystem path. */
  private objectPath(oid: Oid): string {
    return join(this.gitDir, "objects", oid.slice(0, 2), oid.slice(2));
  }
}

/** Zlib-deflates a Uint8Array. */
const deflateBytes$ = (data: Uint8Array): Observable<Uint8Array> =>
  new Observable((subscriber) => {
    const deflate = createDeflate();
    const chunks: Uint8Array[] = [];

    deflate.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    deflate.on("end", () => {
      subscriber.next(concatChunks(chunks));
      subscriber.complete();
    });
    deflate.on("error", (error) => subscriber.error(error));

    deflate.end(data);
  });

/** Zlib-inflates a Uint8Array. */
const inflateBytes$ = (data: Uint8Array): Observable<Uint8Array> =>
  new Observable((subscriber) => {
    const inflate = createInflate();
    const chunks: Uint8Array[] = [];

    inflate.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    inflate.on("end", () => {
      subscriber.next(concatChunks(chunks));
      subscriber.complete();
    });
    inflate.on("error", (error) => subscriber.error(error));

    inflate.end(data);
  });


