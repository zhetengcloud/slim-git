import type { GitObject, Oid } from "@slim-git/types";

export interface StorageBackend {
  readonly name: string;
  readObject(oid: Oid): Promise<GitObject>;
  writeObject(object: GitObject): Promise<GitObject>;
  exists(oid: Oid): Promise<boolean>;
}
