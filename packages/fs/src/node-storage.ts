import type { StorageBackend } from "@slim-git/core";
import { NotFoundError } from "@slim-git/types";
import type { GitObject, ObjectType, Oid } from "@slim-git/types";
import { createInflate, createDeflate } from "node:zlib";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { catchError, concatMap, from, map, type Observable, throwError } from "rxjs";

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
      concatMap((buffer) => inflateBytes(new Uint8Array(buffer))),
      map((raw) => parseObjectBytes(raw, oid)),
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
    return from(deflateBytes(bytes)).pipe(
      concatMap((compressed) =>
        from(mkdir(dirname(this.objectPath(object.oid)), { recursive: true })).pipe(
          concatMap(() => from(writeFile(this.objectPath(object.oid), compressed))),
        ),
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

/** Checks whether an unknown value is a Node.js ENOENT error. */
const isNodeNotFoundError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

/** Serializes a Git object into `<type> <size>\0<content>` bytes. */
const buildObjectBytes = (type: ObjectType, content: Uint8Array): Uint8Array => {
  const header = new TextEncoder().encode(`${type} ${content.length}\0`);
  const result = new Uint8Array(header.length + content.length);
  result.set(header);
  result.set(content, header.length);
  return result;
};

/** Parses canonical object bytes and verifies the oid matches the content. */
const parseObjectBytes = (raw: Uint8Array, oid: Oid): GitObject => {
  const spaceIndex = raw.indexOf(0x20);
  const nullIndex = raw.indexOf(0x00, spaceIndex + 1);
  if (spaceIndex === -1 || nullIndex === -1) {
    throw new Error(`Malformed object ${oid}`);
  }

  const type = new TextDecoder().decode(raw.slice(0, spaceIndex)) as ObjectType;
  const size = Number.parseInt(new TextDecoder().decode(raw.slice(spaceIndex + 1, nullIndex)), 10);
  const content = raw.slice(nullIndex + 1);

  if (Number.isNaN(size) || content.length !== size) {
    throw new Error(`Object ${oid} size mismatch`);
  }

  return { type, content, oid };
};

/** Zlib-deflates a Uint8Array. */
const deflateBytes = (data: Uint8Array): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const deflate = createDeflate();
    const chunks: Uint8Array[] = [];

    deflate.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    deflate.on("end", () => resolve(concatChunks(chunks)));
    deflate.on("error", reject);

    deflate.end(data);
  });

/** Zlib-inflates a Uint8Array. */
const inflateBytes = (data: Uint8Array): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const inflate = createInflate();
    const chunks: Uint8Array[] = [];

    inflate.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    inflate.on("end", () => resolve(concatChunks(chunks)));
    inflate.on("error", reject);

    inflate.end(data);
  });

/** Concatenates an array of Uint8Arrays into one. */
const concatChunks = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};

/** True if the file exists. */
const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeNotFoundError(error)) return false;
    throw error;
  }
};
