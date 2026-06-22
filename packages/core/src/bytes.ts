import type { ObjectType } from "@slim-git/types";

/**
 * Concatenates two Uint8Arrays into a new one.
 *
 * The returned array has length `a.length + b.length` and contains `a`
 * followed by `b`.
 */
export const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
};

/**
 * Converts a byte array to a lowercase hexadecimal string.
 *
 * Commonly used to turn raw hash bytes into an `Oid`.
 */
export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

/**
 * Builds the canonical on-disk byte representation of a Git object.
 *
 * Format: `<type> <size>\0<content>`.
 */
export const buildObjectBytes = (type: ObjectType, content: Uint8Array): Uint8Array => {
  const header = new TextEncoder().encode(`${type} ${content.length}\0`);
  return concatBytes(header, content);
};

/**
 * Parses the canonical `<type> <size>\0<content>` bytes of a Git object.
 *
 * Throws if the header is malformed or the declared size does not match the
 * trailing content.
 */
export const parseObjectBytes = (
  raw: Uint8Array,
): { readonly type: ObjectType; readonly content: Uint8Array } => {
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

  return { type: typeText as ObjectType, content };
};

/** Reads a big-endian unsigned 32-bit integer from a buffer at `offset`. */
export const readUint32 = (buffer: Uint8Array, offset: number): number =>
  (buffer[offset]! << 24) |
  (buffer[offset + 1]! << 16) |
  (buffer[offset + 2]! << 8) |
  buffer[offset + 3]!;

/** Encodes a number as a big-endian unsigned 32-bit byte array. */
export const writeUint32 = (value: number): Uint8Array =>
  new Uint8Array([(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);

/** Reads a big-endian unsigned 16-bit integer from a buffer at `offset`. */
export const readUint16 = (buffer: Uint8Array, offset: number): number =>
  (buffer[offset]! << 8) | buffer[offset + 1]!;

/** Encodes a number as a big-endian unsigned 16-bit byte array. */
export const writeUint16 = (value: number): Uint8Array =>
  new Uint8Array([(value >> 8) & 0xff, value & 0xff]);

/**
 * Concatenates an array of Uint8Arrays into a single Uint8Array.
 *
 * Useful for reassembling chunks produced by streaming operations such as
 * zlib compression.
 */
export const concatChunks = (chunks: readonly Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
};
