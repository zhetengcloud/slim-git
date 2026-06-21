import type { GitObject, ObjectType, Oid } from "@slim-git/types";
import type { StorageBackend } from "./backend.js";
import type { HashAlgorithm } from "./hash.js";

/**
 * High-level object database API.
 *
 * Combines a `StorageBackend` with a `HashAlgorithm` to provide the canonical
 * Git operations: hash, write, read, and exists.
 */
export class ObjectStore {
  constructor(
    private readonly backend: StorageBackend,
    private readonly algorithm: HashAlgorithm,
  ) {}

  get hashAlgorithm(): HashAlgorithm {
    return this.algorithm;
  }

  /** Computes the oid for a given object without persisting it. */
  hashObject(type: ObjectType, content: Uint8Array): GitObject {
    return this.algorithm.hashObject(type, content);
  }

  /** Hashes the object and writes it to the backing store. */
  async write(type: ObjectType, content: Uint8Array): Promise<GitObject> {
    const object = this.hashObject(type, content);
    return this.backend.writeObject(object);
  }

  /** Reads an object by oid from the backing store. */
  async read(oid: Oid): Promise<GitObject> {
    return this.backend.readObject(oid);
  }

  /** Checks whether an object with the given oid exists in the store. */
  async exists(oid: Oid): Promise<boolean> {
    return this.backend.exists(oid);
  }
}
