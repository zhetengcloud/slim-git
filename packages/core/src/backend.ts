import type { GitObject, Oid } from "@slim-git/types";

/**
 * Pluggable storage backend for the Git object database.
 * Implementations may store objects on disk, in memory, or in a database.
 */
export interface StorageBackend {
  readonly name: string;
  readObject(oid: Oid): Promise<GitObject>;
  writeObject(object: GitObject): Promise<GitObject>;
  exists(oid: Oid): Promise<boolean>;
}
