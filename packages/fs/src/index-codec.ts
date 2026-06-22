import type { IndexEntry, Oid } from "@slim-git/types";
import { ParseError } from "@slim-git/types";
import { bytesToHex, Index } from "@slim-git/core";
import { createHash } from "node:crypto";
import {
  concatMap,
  defaultIfEmpty,
  defer,
  last,
  map,
  of,
  range,
  scan,
  throwError,
  type Observable,
} from "rxjs";

/**
 * Git index v2 binary codec.
 *
 * Encodes and decodes the staging-area index used by slim-git. The format is
 * compatible with canonical Git's index v2 for SHA-1 repositories.
 *
 * Layout:
 * - Header: "DIRC" + 4-byte version (2) + 4-byte entry count.
 * - Entries: ctime, mtime, dev, ino, mode, uid, gid, size, oid, flags, path.
 * - Trailer: SHA-1 checksum of the preceding bytes.
 */

const HEADER_SIGNATURE = new TextEncoder().encode("DIRC");
const VERSION = 2;
const OID_BYTES = 20;

/** Encodes an `Index` into a Git index v2 byte buffer. */
export const encodeIndex = (index: Index): Uint8Array => {
  const entries = index.toArray();
  const entryChunks = entries.map((entry) => encodeIndexEntry(entry));
  const contentLength = 12 + entryChunks.reduce((sum, chunk) => sum + chunk.length, 0) + OID_BYTES;

  const buffer = new Uint8Array(contentLength);
  let offset = 0;

  buffer.set(HEADER_SIGNATURE, offset);
  offset += 4;
  offset = writeUint32At(buffer, offset, VERSION);
  offset = writeUint32At(buffer, offset, entries.length);

  for (const chunk of entryChunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  const checksum = computeChecksum(buffer.slice(0, offset));
  buffer.set(checksum, offset);

  return buffer;
};

/**
 * Decodes a Git index v2 byte buffer into an `Index`.
 *
 * Returns an `Observable` so parse errors travel through RxJS's error channel
 * and can be handled with `catchError` instead of thrown synchronously.
 */
export const decodeIndex = (buffer: Uint8Array): Observable<Index> =>
  readIndexHeader(buffer).pipe(
    concatMap(({ entryCount }) =>
      range(0, entryCount).pipe(
        scan(
          (state) => {
            const { entry, bytesRead } = decodeIndexEntry(buffer, state.offset);
            return {
              offset: state.offset + bytesRead,
              entries: [...state.entries, entry],
            };
          },
          { offset: 12, entries: [] as readonly IndexEntry[] },
        ),
        defaultIfEmpty({ offset: 12, entries: [] as readonly IndexEntry[] }),
        last(),
        map((state) => Index.from(state.entries)),
      ),
    ),
  );

/** Reads the index header and emits the entry count, or an error on bad input. */
export const readIndexHeader = (
  buffer: Uint8Array,
): Observable<{ readonly entryCount: number }> =>
  defer(() => {
    if (buffer.length < 12) {
      return throwError(() => new ParseError("index buffer too short"));
    }

    const signature = new TextDecoder().decode(buffer.slice(0, 4));
    if (signature !== "DIRC") {
      return throwError(() => new ParseError(`unsupported index signature: ${signature}`));
    }

    const version = readUint32At(buffer, 4);
    if (version !== VERSION) {
      return throwError(() => new ParseError(`unsupported index version: ${version}`));
    }

    return of({ entryCount: readUint32At(buffer, 8) });
  });

/** Encodes a single index entry. */
export const encodeIndexEntry = (entry: IndexEntry): Uint8Array => {
  const pathBytes = new TextEncoder().encode(entry.path);
  const pathPaddedLength = Math.ceil((pathBytes.length + 1) / 8) * 8;
  const entryLength = 62 + pathPaddedLength;

  const buffer = new Uint8Array(entryLength);
  let offset = 0;

  offset = writeTimestamp(buffer, offset, entry.ctimeSeconds, entry.ctimeNanos);
  offset = writeTimestamp(buffer, offset, entry.mtimeSeconds, entry.mtimeNanos);
  offset = writeUint32At(buffer, offset, entry.dev);
  offset = writeUint32At(buffer, offset, entry.ino);
  offset = writeUint32At(buffer, offset, entry.mode);
  offset = writeUint32At(buffer, offset, entry.uid);
  offset = writeUint32At(buffer, offset, entry.gid);
  offset = writeUint32At(buffer, offset, entry.fileSize);

  buffer.set(oidToBytes(entry.oid), offset);
  offset += OID_BYTES;

  offset = writeUint16At(buffer, offset, buildIndexEntryFlags(entry));

  buffer.set(pathBytes, offset);
  offset += pathBytes.length;
  buffer[offset] = 0;
  offset += pathPaddedLength - pathBytes.length;

  return buffer;
};

/** Decodes a single index entry and returns the bytes consumed. */
export const decodeIndexEntry = (
  buffer: Uint8Array,
  start: number,
): { readonly entry: IndexEntry; readonly bytesRead: number } => {
  let offset = start;

  const ctimeSeconds = readUint32At(buffer, offset);
  const ctimeNanos = readUint32At(buffer, offset + 4);
  offset += 8;

  const mtimeSeconds = readUint32At(buffer, offset);
  const mtimeNanos = readUint32At(buffer, offset + 4);
  offset += 8;

  const dev = readUint32At(buffer, offset);
  offset += 4;
  const ino = readUint32At(buffer, offset);
  offset += 4;
  const mode = readUint32At(buffer, offset);
  offset += 4;
  const uid = readUint32At(buffer, offset);
  offset += 4;
  const gid = readUint32At(buffer, offset);
  offset += 4;
  const fileSize = readUint32At(buffer, offset);
  offset += 4;

  const oid = bytesToOid(buffer.slice(offset, offset + OID_BYTES));
  offset += OID_BYTES;

  const flags = readUint16At(buffer, offset);
  offset += 2;

  const stage = (flags >> 12) & 0x03;

  const pathStart = offset;
  let pathEnd = pathStart;
  while (buffer[pathEnd] !== 0) {
    pathEnd++;
  }
  const path = new TextDecoder().decode(buffer.slice(pathStart, pathEnd));
  offset = pathStart + Math.ceil((pathEnd - pathStart + 1) / 8) * 8;

  return {
    entry: {
      path,
      oid,
      mode,
      stage,
      fileSize,
      ctimeSeconds,
      ctimeNanos,
      mtimeSeconds,
      mtimeNanos,
      dev,
      ino,
      uid,
      gid,
      assumeValid: (flags & 0x8000) !== 0,
      extended: false,
      skipWorktree: false,
      intentToAdd: false,
    },
    bytesRead: offset - start,
  };
};

/** Computes a SHA-1 checksum of the given bytes. */
export const computeChecksum = (data: Uint8Array): Uint8Array => {
  const hash = createHash("sha1");
  hash.update(data);
  return new Uint8Array(hash.digest());
};

/** Converts a hex oid string to bytes. */
export const oidToBytes = (oid: Oid): Uint8Array => {
  const result = new Uint8Array(OID_BYTES);
  for (let i = 0; i < OID_BYTES; i++) {
    result[i] = Number.parseInt(oid.slice(i * 2, i * 2 + 2), 16);
  }
  return result;
};

/** Converts oid bytes to a lowercase hex string. */
export const bytesToOid = (bytes: Uint8Array): Oid => bytesToHex(bytes) as Oid;

/** Builds the 16-bit flags field from an index entry. */
export const buildIndexEntryFlags = (entry: IndexEntry): number => {
  const nameLength = Math.min(entry.path.length, 0x0fff);
  const stage = (entry.stage & 0x03) << 12;
  const assumeValid = entry.assumeValid ? 0x8000 : 0;
  return assumeValid | stage | nameLength;
};

/** Writes a 32-bit big-endian integer. */
export const writeUint32At = (buffer: Uint8Array, offset: number, value: number): number => {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
  view.setUint32(0, value, false);
  return offset + 4;
};

/** Reads a 32-bit big-endian integer. */
export const readUint32At = (buffer: Uint8Array, offset: number): number => {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 4);
  return view.getUint32(0, false);
};

/** Writes a 16-bit big-endian integer. */
export const writeUint16At = (buffer: Uint8Array, offset: number, value: number): number => {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 2);
  view.setUint16(0, value, false);
  return offset + 2;
};

/** Reads a 16-bit big-endian integer. */
export const readUint16At = (buffer: Uint8Array, offset: number): number => {
  const view = new DataView(buffer.buffer, buffer.byteOffset + offset, 2);
  return view.getUint16(0, false);
};

/** Writes seconds and nanoseconds as two big-endian 32-bit integers. */
export const writeTimestamp = (
  buffer: Uint8Array,
  offset: number,
  seconds: number,
  nanos: number,
): number => {
  let next = writeUint32At(buffer, offset, seconds);
  next = writeUint32At(buffer, next, nanos);
  return next;
};
