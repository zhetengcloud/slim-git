import type { GitObject, ObjectType, Oid } from "@slim-git/types";
import type { HashAlgorithm } from "@slim-git/core";
import { createHash } from "node:crypto";
import { deflateSync, Inflate } from "node:zlib";

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

/** Builds the canonical on-disk representation of a Git object. */
const encodeObjectBytes = (type: ObjectType, content: Uint8Array): Uint8Array => {
  const header = new TextEncoder().encode(`${type} ${content.length}\0`);
  const result = new Uint8Array(header.length + content.length);
  result.set(header);
  result.set(content, header.length);
  return result;
};

/**
 * Parses the canonical `<type> <size>\0<content>` bytes of a Git object.
 *
 * Throws if the header is malformed or the size does not match the content.
 */
const parseObjectBytes = (raw: Uint8Array): { readonly type: ObjectType; readonly content: Uint8Array } => {
  const spaceIndex = raw.indexOf(0x20);
  const nullIndex = raw.indexOf(0x00, spaceIndex + 1);

  if (spaceIndex === -1 || nullIndex === -1) {
    throw new Error("Invalid object header");
  }

  const typeText = new TextDecoder().decode(raw.slice(0, spaceIndex));
  const sizeText = new TextDecoder().decode(raw.slice(spaceIndex + 1, nullIndex));
  const size = Number.parseInt(sizeText, 10);
  const content = raw.slice(nullIndex + 1);

  if (Number.isNaN(size) || content.length !== size) {
    throw new Error("Object size mismatch");
  }

  const type = typeText as ObjectType;
  return { type, content };
};

/** Concatenates two Uint8Arrays. */
const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
};

/** Reads a big-endian unsigned 32-bit integer from a buffer. */
const readUInt32 = (buffer: Uint8Array, offset: number): number =>
  (buffer[offset]! << 24) |
  (buffer[offset + 1]! << 16) |
  (buffer[offset + 2]! << 8) |
  buffer[offset + 3]!;

/** Writes a big-endian unsigned 32-bit integer into a buffer. */
const writeUInt32 = (value: number): Uint8Array =>
  new Uint8Array([(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);

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
const decodeOffset = (buffer: Uint8Array, offset: number): { readonly value: number; readonly bytesRead: number } => {
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
const inflateObject = (input: Uint8Array): Promise<{ readonly data: Uint8Array; readonly consumed: number }> =>
  new Promise((resolve, reject) => {
    const inflate = new Inflate();
    const chunks: Uint8Array[] = [];

    inflate.on("data", (chunk: Buffer) => {
      chunks.push(new Uint8Array(chunk));
    });

    inflate.on("end", () => {
      const data = chunks.reduce(
        (acc, chunk) => {
          const result = new Uint8Array(acc.length + chunk.length);
          result.set(acc);
          result.set(chunk, acc.length);
          return result;
        },
        new Uint8Array(0),
      );
      resolve({ data, consumed: inflate.bytesWritten });
    });

    inflate.on("error", reject);
    inflate.write(Buffer.from(input));
    inflate.end();
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
export const applyDelta = (delta: Uint8Array, base: Uint8Array): Uint8Array => {
  let position = 0;

  const readVarint = (): number => {
    let byte = delta[position]!;
    let value = byte & 0x7f;
    position++;

    while ((byte & 0x80) !== 0) {
      byte = delta[position]!;
      value = ((value + 1) << 7) | (byte & 0x7f);
      position++;
    }

    return value;
  };

  const baseLength = readVarint();
  if (baseLength !== base.length) {
    throw new Error(`Delta base length mismatch: expected ${base.length}, got ${baseLength}`);
  }

  const resultLength = readVarint();
  const result = new Uint8Array(resultLength);
  let written = 0;

  while (position < delta.length) {
    const instruction = delta[position]!;
    position++;

    if ((instruction & 0x80) === 0) {
      // Insert instruction: copy the next `size` bytes literally from the delta.
      let size = instruction & 0x7f;
      if (size === 0) {
        size = 0x10000;
      }
      result.set(delta.slice(position, position + size), written);
      position += size;
      written += size;
    } else {
      // Copy instruction: copy `size` bytes from `base` at `offset`.
      let offset = 0;
      let size = 0;

      if ((instruction & 0x01) !== 0) offset |= delta[position]!;
      if ((instruction & 0x02) !== 0) offset |= delta[position + 1]! << 8;
      if ((instruction & 0x04) !== 0) offset |= delta[position + 2]! << 16;
      if ((instruction & 0x08) !== 0) offset |= delta[position + 3]! << 24;

      const offsetBytes =
        ((instruction & 0x01) >> 0) +
        ((instruction & 0x02) >> 1) +
        ((instruction & 0x04) >> 2) +
        ((instruction & 0x08) >> 3);

      if ((instruction & 0x10) !== 0) size |= delta[position + offsetBytes]!;
      if ((instruction & 0x20) !== 0) size |= delta[position + offsetBytes + 1]! << 8;
      if ((instruction & 0x40) !== 0) size |= delta[position + offsetBytes + 2]! << 16;

      const sizeBytes =
        ((instruction & 0x10) >> 4) +
        ((instruction & 0x20) >> 5) +
        ((instruction & 0x40) >> 6);

      position += offsetBytes + sizeBytes;

      if (size === 0) {
        size = 0x10000;
      }

      result.set(base.slice(offset, offset + size), written);
      written += size;
    }
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
    raw: encodeObjectBytes(object.type, object.content),
    type: object.type,
    oid: object.oid,
  }));

  // Canonical packfiles store objects sorted by oid ascending.
  entries.sort((a, b) => a.oid.localeCompare(b.oid));

  const dataChunks: Uint8Array[] = [];

  for (const entry of entries) {
    const type = PackObjectType[entry.type];
    const header = encodeTypeSize(type, entry.raw.length);
    const compressed = deflateSync(Buffer.from(entry.raw));
    dataChunks.push(header, new Uint8Array(compressed));
  }

  const data = dataChunks.reduce(
    (acc, chunk) => {
      const result = new Uint8Array(acc.length + chunk.length);
      result.set(acc);
      result.set(chunk, acc.length);
      return result;
    },
    new Uint8Array(0),
  );

  const header = new Uint8Array(PackMagic.length + 8);
  header.set(PackMagic);
  header.set(writeUInt32(PackVersion), PackMagic.length);
  header.set(writeUInt32(entries.length), PackMagic.length + 4);

  const checksum = createHash("sha1").update(Buffer.from(header)).update(Buffer.from(data)).digest();

  return concatBytes(concatBytes(header, data), new Uint8Array(checksum));
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
 * @returns The decoded objects with their computed oids.
 */
export const parsePackfile = async (
  buffer: Uint8Array,
  hashAlgorithm: HashAlgorithm,
): Promise<readonly GitObject[]> => {
  if (buffer.length < PackMagic.length + 8 + ChecksumLength) {
    throw new Error("Packfile too small");
  }

  for (let index = 0; index < PackMagic.length; index++) {
    if (buffer[index] !== PackMagic[index]) {
      throw new Error("Invalid packfile magic");
    }
  }

  const version = readUInt32(buffer, PackMagic.length);
  if (version !== PackVersion) {
    throw new Error(`Unsupported packfile version: ${version}`);
  }

  const objectCount = readUInt32(buffer, PackMagic.length + 4);
  const checksumOffset = buffer.length - ChecksumLength;

  const expectedChecksum = buffer.slice(checksumOffset);
  const actualChecksum = createHash("sha1").update(Buffer.from(buffer.slice(0, checksumOffset))).digest();
  for (let index = 0; index < ChecksumLength; index++) {
    if (expectedChecksum[index] !== actualChecksum[index]) {
      throw new Error("Packfile checksum mismatch");
    }
  }

  // Raw object bytes keyed by the offset where the object entry starts.
  const rawByOffset = new Map<number, Uint8Array>();
  // Completed objects keyed by oid, used to resolve REF_DELTA bases within the pack.
  const objectsByOid = new Map<Oid, GitObject>();

  let position = PackMagic.length + 8;

  for (let index = 0; index < objectCount; index++) {
    const entryStart = position;
    const { type, size, bytesRead: headerBytes } = decodeTypeSize(buffer, position);
    position += headerBytes;

    const { data, consumed } = await inflateObject(buffer.slice(position));
    position += consumed;

    if (data.length !== size) {
      throw new Error(`Pack object size mismatch: expected ${size}, got ${data.length}`);
    }

    let raw: Uint8Array;

    if (type === PackObjectType.ofsDelta) {
      const { value: offset, bytesRead: offsetBytes } = decodeOffset(buffer, position);
      position += offsetBytes;
      const baseOffset = entryStart - offset;
      const baseRaw = rawByOffset.get(baseOffset);
      if (baseRaw === undefined) {
        throw new Error(`Missing OFS_DELTA base at offset ${baseOffset}`);
      }
      raw = applyDelta(data, baseRaw);
    } else if (type === PackObjectType.refDelta) {
      const baseOid = new TextDecoder().decode(buffer.slice(position, position + 20)) as Oid;
      position += 20;
      const baseObject = objectsByOid.get(baseOid);
      if (baseObject === undefined) {
        throw new Error(`Missing REF_DELTA base ${baseOid}`);
      }
      raw = applyDelta(data, encodeObjectBytes(baseObject.type, baseObject.content));
    } else {
      raw = data;
    }

    rawByOffset.set(entryStart, raw);

    const { type: objectType, content } = parseObjectBytes(raw);
    const object = hashAlgorithm.hashObject(objectType, content);
    objectsByOid.set(object.oid, object);
  }

  return Array.from(objectsByOid.values());
};
