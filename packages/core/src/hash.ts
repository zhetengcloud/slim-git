import { createHash } from "node:crypto";
import type { GitObject, HashAlgorithmName, ObjectType, Oid } from "@slim-git/types";

/** Hash algorithm abstraction used by the object store. */
export interface HashAlgorithm {
  readonly name: HashAlgorithmName;
  hash(data: Uint8Array): Oid;
  hashObject(type: ObjectType, content: Uint8Array): GitObject;
}

/** Builds the Git object header: `<type> <size>\0`. */
const encodeHeader = (type: ObjectType, size: number): Uint8Array => {
  const header = `${type} ${size}\0`;
  return new TextEncoder().encode(header);
};

/** Concatenates two Uint8Arrays into a new one. */
const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
};

/**
 * A Git object's canonical bytes are `<type> <size>\0` followed by the raw content.
 * These bytes are what get hashed to produce the object's oid.
 */
const buildObjectBytes = (type: ObjectType, content: Uint8Array): Uint8Array =>
  concatBytes(encodeHeader(type, content.length), content);

/** Converts raw hash bytes into a lowercase hex oid string. */
const toHex = (bytes: Uint8Array): Oid =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("") as Oid;

/** Factory for SHA-1 or SHA-256 Git hash algorithms. */
const createGitHash = (algorithm: "sha1" | "sha256") => {
  const digest = (data: Uint8Array): Oid => {
    const hash = createHash(algorithm);
    hash.update(data);
    return toHex(new Uint8Array(hash.digest())) as Oid;
  };

  return {
    name: algorithm as HashAlgorithmName,
    hash: (data: Uint8Array): Oid => digest(data),
    hashObject: (type: ObjectType, content: Uint8Array): GitObject => {
      const bytes = buildObjectBytes(type, content);
      return {
        type,
        content,
        oid: digest(bytes),
      };
    },
  };
};

/** SHA-1 hash algorithm; produces 40-character oids and matches canonical Git defaults. */
export const Sha1Hash: HashAlgorithm = createGitHash("sha1");

/** SHA-256 hash algorithm; produces 64-character oids for future-proof repositories. */
export const Sha256Hash: HashAlgorithm = createGitHash("sha256");

/** Default hash algorithm used when none is specified. */
export const DefaultHash = Sha1Hash;
