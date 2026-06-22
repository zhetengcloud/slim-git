import type { GitObject, Oid } from "@slim-git/types";
import {
  buildObjectBytes,
  concatBytes,
  concatChunks,
  parseObjectBytes,
  readUint32,
  type HashAlgorithm,
  writeUint32,
} from "@slim-git/core";
import { createHash } from "node:crypto";
import { deflateSync, Inflate } from "node:zlib";
import { defer, EMPTY, expand, last, map, Observable, of } from "rxjs";

/** Packfile object type constants. */
const PackObjectType = {
  commit: 1,
  tree: 2,
  blob: 3,
  tag: 4,
  ofsDelta: 6,
  refDelta: 7,
} as const;

/** Packfile magic header. */
const PackMagic = new TextEncoder().encode("PACK");

/** Packfile version number. */
const PackVersion = 2;

/** SHA-1 checksum length in bytes. */
const ChecksumLength = 20;

/**
 * Encodes a packfile object header (type + size) as a variable-length integer.
 *
 * The first byte stores the type in bits 4-6 and the low 4 bits of the size.
 * Continuation bytes store 7 more size bits each.
 */
const encodeTypeSize = (type: number, size: number): Uint8Array => {
  const bytes: number[] = [];
  let byte = (type << 4) | (size & 0x0f);
  let remaining = size >> 4;

  while (remaining > 0) {
    byte |= 0x80;
    bytes.push(byte);
    byte = remaining & 0x7f;
    remaining >>= 7;
  }

  bytes.push(byte);
  return new Uint8Array(bytes);
};

/**
 * Decodes a packfile object header from `buffer` starting at `offset`.
 *
 * Returns the pack type, object size, and number of header bytes consumed.
 */
const decodeTypeSize = (
  buffer: Uint8Array,
  offset: number,
): { readonly type: number; readonly size: number; readonly bytesRead: number } => {
  let byte = buffer[offset]!;
  const type = (byte >> 4) & 0x07;
  let size = byte & 0x0f;
  let shift = 4;
  let bytesRead = 1;

  while ((byte & 0x80) !== 0) {
    byte = buffer[offset + bytesRead]!;
    size |= (byte & 0x7f) << shift;
    shift += 7;
    bytesRead++;
  }

  return { type, size, bytesRead };
};

/**
 * Decodes a variable-length offset used by `OBJ_OFS_DELTA`.
 *
 * Offsets are relative to the current object and encoded with MSB continuation.
 * One is added before each left shift to avoid ambiguous encodings.
 */
const decodeOffset = (
  buffer: Uint8Array,
  offset: number,
): { readonly value: number; readonly bytesRead: number } => {
  let byte = buffer[offset]!;
  let value = byte & 0x7f;
  let bytesRead = 1;

  while ((byte & 0x80) !== 0) {
    byte = buffer[offset + bytesRead]!;
    value = ((value + 1) << 7) | (byte & 0x7f);
    bytesRead++;
  }

  return { value, bytesRead };
};

/**
 * Decompresses a single zlib stream from the start of `input`.
 *
 * Returns the decompressed bytes and the number of compressed input bytes
 * consumed. This lets the packfile parser step from one object to the next.
 */
const inflateObject$ = (
  input: Uint8Array,
): Observable<{ readonly data: Uint8Array; readonly consumed: number }> =>
  new Observable((subscriber) => {
    const inflate = new Inflate();
    const chunks: Uint8Array[] = [];

    inflate.on("data", (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
    inflate.on("end", () => {
      subscriber.next({ data: concatChunks(chunks), consumed: inflate.bytesWritten });
      subscriber.complete();
    });
    inflate.on("error", (error) => subscriber.error(error));
    inflate.end(Buffer.from(input));
  });

/**
 * Applies a Git delta instruction stream to a base object.
 *
 * The base and result must both be the canonical object bytes
 * (`<type> <size>\0<content>`). After applying the delta, the caller parses
 * the resulting bytes as a normal object.
 *
 * See `gitformat-pack.txt` for the delta format.
 */
const readVarint = (
  buffer: Uint8Array,
  offset: number,
): { readonly value: number; readonly nextPosition: number } => {
  let byte = buffer[offset]!;
  let value = byte & 0x7f;
  let position = offset + 1;

  while ((byte & 0x80) !== 0) {
    byte = buffer[position]!;
    value = ((value + 1) << 7) | (byte & 0x7f);
    position++;
  }

  return { value, nextPosition: position };
};

/**
 * Decodes an insert instruction: copy `size` literal bytes from the delta.
 *
 * A size of zero encodes the maximum insert size (64 KiB).
 */
const decodeInsertInstruction = (
  delta: Uint8Array,
  position: number,
  instruction: number,
): { readonly bytes: Uint8Array; readonly nextPosition: number } => {
  let size = instruction & 0x7f;
  if (size === 0) {
    size = 0x10000;
  }
  return { bytes: delta.slice(position, position + size), nextPosition: position + size };
};

/**
 * Decodes a copy instruction: copy `size` bytes from `base` at `offset`.
 *
 * Present bytes are selected by bit flags; a zero size encodes 64 KiB.
 */
const decodeCopyInstruction = (
  delta: Uint8Array,
  base: Uint8Array,
  position: number,
  instruction: number,
): { readonly bytes: Uint8Array; readonly nextPosition: number } => {
  let offset = 0;
  if ((instruction & 0x01) !== 0) offset |= delta[position]!;
  if ((instruction & 0x02) !== 0) offset |= delta[position + 1]! << 8;
  if ((instruction & 0x04) !== 0) offset |= delta[position + 2]! << 16;
  if ((instruction & 0x08) !== 0) offset |= delta[position + 3]! << 24;

  const offsetBytes =
    ((instruction & 0x01) >> 0) +
    ((instruction & 0x02) >> 1) +
    ((instruction & 0x04) >> 2) +
    ((instruction & 0x08) >> 3);

  let size = 0;
  if ((instruction & 0x10) !== 0) size |= delta[position + offsetBytes]!;
  if ((instruction & 0x20) !== 0) size |= delta[position + offsetBytes + 1]! << 8;
  if ((instruction & 0x40) !== 0) size |= delta[position + offsetBytes + 2]! << 16;

  const sizeBytes =
    ((instruction & 0x10) >> 4) + ((instruction & 0x20) >> 5) + ((instruction & 0x40) >> 6);

  if (size === 0) {
    size = 0x10000;
  }

  return {
    bytes: base.slice(offset, offset + size),
    nextPosition: position + offsetBytes + sizeBytes,
  };
};

/**
 * Applies a Git delta instruction stream to a base object.
 *
 * The base and result must both be the canonical object bytes
 * (`<type> <size>\0<content>`). After applying the delta, the caller parses
 * the resulting bytes as a normal object.
 *
 * See `gitformat-pack.txt` for the delta format.
 */
export const applyDelta = (delta: Uint8Array, base: Uint8Array): Uint8Array => {
  let header = readVarint(delta, 0);
  if (header.value !== base.length) {
    throw new Error(`Delta base length mismatch: expected ${base.length}, got ${header.value}`);
  }

  header = readVarint(delta, header.nextPosition);
  const resultLength = header.value;
  const result = new Uint8Array(resultLength);
  let written = 0;
  let position = header.nextPosition;

  while (position < delta.length) {
    const instruction = delta[position]!;
    position++;

    const { bytes, nextPosition } =
      (instruction & 0x80) === 0
        ? decodeInsertInstruction(delta, position, instruction)
        : decodeCopyInstruction(delta, base, position, instruction);

    result.set(bytes, written);
    position = nextPosition;
    written += bytes.length;
  }

  if (written !== resultLength) {
    throw new Error(`Delta result length mismatch: expected ${resultLength}, got ${written}`);
  }

  return result;
};

/**
 * Builds a Git packfile (version 2) from a set of objects.
 *
 * Objects are stored undeltified with zlib compression. The resulting packfile
 * is self-contained and can be consumed by canonical Git servers.
 *
 * @param objects - Objects to include in the packfile. Each object must already
 *   carry its correct oid; the packfile is sorted by oid.
 * @returns The complete packfile bytes, including the trailing checksum.
 */
export const buildPackfile = (objects: readonly GitObject[]): Uint8Array => {
  const entries = objects.map((object) => ({
    raw: buildObjectBytes(object.type, object.content),
    type: object.type,
    oid: object.oid,
  }));

  // Canonical packfiles store objects sorted by oid ascending.
  entries.sort((a, b) => a.oid.localeCompare(b.oid));

  const dataChunks = entries.flatMap((entry) => {
    const type = PackObjectType[entry.type];
    const header = encodeTypeSize(type, entry.raw.length);
    const compressed = deflateSync(Buffer.from(entry.raw));
    return [header, new Uint8Array(compressed)];
  });
  const data = concatChunks(dataChunks);

  const header = new Uint8Array(PackMagic.length + 8);
  header.set(PackMagic);
  header.set(writeUint32(PackVersion), PackMagic.length);
  header.set(writeUint32(entries.length), PackMagic.length + 4);

  const checksum = createHash("sha1")
    .update(Buffer.from(header))
    .update(Buffer.from(data))
    .digest();

  return concatBytes(concatBytes(header, data), new Uint8Array(checksum));
};

/** Parsed packfile header fields. */
type PackHeader = {
  readonly version: number;
  readonly objectCount: number;
  readonly dataStart: number;
};

/**
 * Validates the packfile header and trailing checksum.
 *
 * Throws on malformed headers, unsupported versions, or checksum mismatches.
 */
const readPackHeader = (buffer: Uint8Array): PackHeader => {
  if (buffer.length < PackMagic.length + 8 + ChecksumLength) {
    throw new Error("Packfile too small");
  }

  for (let index = 0; index < PackMagic.length; index++) {
    if (buffer[index] !== PackMagic[index]) {
      throw new Error("Invalid packfile magic");
    }
  }

  const version = readUint32(buffer, PackMagic.length);
  if (version !== PackVersion) {
    throw new Error(`Unsupported packfile version: ${version}`);
  }

  const objectCount = readUint32(buffer, PackMagic.length + 4);
  const checksumOffset = buffer.length - ChecksumLength;

  const expectedChecksum = buffer.slice(checksumOffset);
  const actualChecksum = createHash("sha1")
    .update(Buffer.from(buffer.slice(0, checksumOffset)))
    .digest();
  for (let index = 0; index < ChecksumLength; index++) {
    if (expectedChecksum[index] !== actualChecksum[index]) {
      throw new Error("Packfile checksum mismatch");
    }
  }

  return { version, objectCount, dataStart: PackMagic.length + 8 };
};

/** A single object entry produced while streaming through a packfile. */
type PackObjectEntry = {
  readonly offset: number;
  readonly raw: Uint8Array;
  readonly object: GitObject;
  readonly nextPosition: number;
};

/** Immutable parser state carried between object entries. */
type ParseState = {
  readonly position: number;
  readonly rawByOffset: ReadonlyMap<number, Uint8Array>;
  readonly objectsByOid: ReadonlyMap<Oid, GitObject>;
  readonly objects: readonly GitObject[];
};

/**
 * Resolves a packfile object entry to its canonical raw bytes.
 *
 * Handles undeltified objects and both OFS_DELTA and REF_DELTA by locating the
 * base object and applying the delta stream.
 */
const resolveRawObject = (
  buffer: Uint8Array,
  type: number,
  data: Uint8Array,
  entryStart: number,
  positionAfterInflation: number,
  rawByOffset: ReadonlyMap<number, Uint8Array>,
  objectsByOid: ReadonlyMap<Oid, GitObject>,
): { readonly raw: Uint8Array; readonly nextPosition: number } => {
  if (type === PackObjectType.ofsDelta) {
    const { value: offset, bytesRead: offsetBytes } = decodeOffset(
      buffer,
      positionAfterInflation,
    );
    const baseOffset = entryStart - offset;
    const baseRaw = rawByOffset.get(baseOffset);
    if (baseRaw === undefined) {
      throw new Error(`Missing OFS_DELTA base at offset ${baseOffset}`);
    }
    return {
      raw: applyDelta(data, baseRaw),
      nextPosition: positionAfterInflation + offsetBytes,
    };
  }

  if (type === PackObjectType.refDelta) {
    const baseOid = new TextDecoder().decode(
      buffer.slice(positionAfterInflation, positionAfterInflation + ChecksumLength),
    ) as Oid;
    const baseObject = objectsByOid.get(baseOid);
    if (baseObject === undefined) {
      throw new Error(`Missing REF_DELTA base ${baseOid}`);
    }
    return {
      raw: applyDelta(data, buildObjectBytes(baseObject.type, baseObject.content)),
      nextPosition: positionAfterInflation + ChecksumLength,
    };
  }

  return { raw: data, nextPosition: positionAfterInflation };
};

/**
 * Parses the next object entry in a packfile starting at `position`.
 *
 * Inflates the object data, resolves any delta references, hashes the result,
 * and returns the parsed entry together with the next byte position.
 */
const parseObjectEntry$ = (
  buffer: Uint8Array,
  position: number,
  entryStart: number,
  hashAlgorithm: HashAlgorithm,
  rawByOffset: ReadonlyMap<number, Uint8Array>,
  objectsByOid: ReadonlyMap<Oid, GitObject>,
): Observable<PackObjectEntry> => {
  const { type, size, bytesRead: headerBytes } = decodeTypeSize(buffer, position);
  const dataStart = position + headerBytes;

  return inflateObject$(buffer.slice(dataStart)).pipe(
    map(({ data, consumed }) => {
      if (data.length !== size) {
        throw new Error(`Pack object size mismatch: expected ${size}, got ${data.length}`);
      }

      const positionAfterInflation = dataStart + consumed;
      const { raw, nextPosition } = resolveRawObject(
        buffer,
        type,
        data,
        entryStart,
        positionAfterInflation,
        rawByOffset,
        objectsByOid,
      );

      const { type: objectType, content } = parseObjectBytes(raw);
      const object = hashAlgorithm.hashObject(objectType, content);

      return {
        offset: entryStart,
        raw,
        object,
        nextPosition,
      };
    }),
  );
};

/**
 * Parses a Git packfile (version 2) and reconstructs the contained objects.
 *
 * Supports `OBJ_COMMIT`, `OBJ_TREE`, `OBJ_BLOB`, `OBJ_TAG`, `OBJ_OFS_DELTA`,
 * and `OBJ_REF_DELTA`. Delta bases must be present in the packfile; external
 * bases are not resolved.
 *
 * @param buffer - Raw packfile bytes.
 * @param hashAlgorithm - Hash algorithm used to compute object ids.
 * @returns An Observable that emits the decoded objects with their computed oids.
 */
export const parsePackfile$ = (
  buffer: Uint8Array,
  hashAlgorithm: HashAlgorithm,
): Observable<readonly GitObject[]> =>
  defer(() => {
    const header = readPackHeader(buffer);

    const initialState: ParseState = {
      position: header.dataStart,
      rawByOffset: new Map(),
      objectsByOid: new Map(),
      objects: [],
    };

    return of(initialState).pipe(
      expand((state) =>
        state.objects.length >= header.objectCount
          ? EMPTY
          : parseObjectEntry$(
              buffer,
              state.position,
              state.position,
              hashAlgorithm,
              state.rawByOffset,
              state.objectsByOid,
            ).pipe(
              map((entry) => ({
                position: entry.nextPosition,
                rawByOffset: new Map(state.rawByOffset).set(entry.offset, entry.raw),
                objectsByOid: new Map(state.objectsByOid).set(entry.object.oid, entry.object),
                objects: [...state.objects, entry.object],
              })),
            ),
      ),
      last(),
      map((state) => state.objects),
    );
  });
