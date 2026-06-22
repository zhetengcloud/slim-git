import { createHash } from "node:crypto";
import type { GitObject, HashAlgorithmName, ObjectType, Oid } from "@slim-git/types";
import { buildObjectBytes, bytesToHex } from "./bytes.js";

/** Hash algorithm abstraction used by the object store. */
export interface HashAlgorithm {
  readonly name: HashAlgorithmName;
  hash(data: Uint8Array): Oid;
  hashObject(type: ObjectType, content: Uint8Array): GitObject;
}

/** Factory for SHA-1 or SHA-256 Git hash algorithms. */
const createGitHash = (algorithm: "sha1" | "sha256") => {
  const digest = (data: Uint8Array): Oid => {
    const hash = createHash(algorithm);
    hash.update(data);
    return bytesToHex(new Uint8Array(hash.digest())) as Oid;
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
