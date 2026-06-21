import { createHash } from "node:crypto";
import type { GitObject, HashAlgorithmName, ObjectType, Oid } from "@slim-git/types";

export interface HashAlgorithm {
  readonly name: HashAlgorithmName;
  hash(data: Uint8Array): Oid;
  hashObject(type: ObjectType, content: Uint8Array): GitObject;
}

const encodeHeader = (type: ObjectType, size: number): Uint8Array => {
  const header = `${type} ${size}\0`;
  return new TextEncoder().encode(header);
};

const concatBytes = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
};

const buildObjectBytes = (type: ObjectType, content: Uint8Array): Uint8Array =>
  concatBytes(encodeHeader(type, content.length), content);

const toHex = (bytes: Uint8Array): Oid =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("") as Oid;

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

export const Sha1Hash: HashAlgorithm = createGitHash("sha1");
export const Sha256Hash: HashAlgorithm = createGitHash("sha256");

export const DefaultHash = Sha1Hash;
