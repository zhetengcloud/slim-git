import type { GitObject, ObjectType, Oid } from "@slim-git/types";
import type { StorageBackend } from "./backend.js";
import type { HashAlgorithm } from "./hash.js";

export class ObjectStore {
  constructor(
    private readonly backend: StorageBackend,
    private readonly algorithm: HashAlgorithm,
  ) {}

  get hashAlgorithm(): HashAlgorithm {
    return this.algorithm;
  }

  hashObject(type: ObjectType, content: Uint8Array): GitObject {
    return this.algorithm.hashObject(type, content);
  }

  async write(type: ObjectType, content: Uint8Array): Promise<GitObject> {
    const object = this.hashObject(type, content);
    return this.backend.writeObject(object);
  }

  async read(oid: Oid): Promise<GitObject> {
    return this.backend.readObject(oid);
  }

  async exists(oid: Oid): Promise<boolean> {
    return this.backend.exists(oid);
  }
}
