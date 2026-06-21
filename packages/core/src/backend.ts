import type { GitObject, Oid } from "@slim-git/types";
import type { Observable } from "rxjs";

/**
 * Pluggable storage backend for the Git object database.
 * Implementations may store objects on disk, in memory, or in a database.
 */
export interface StorageBackend {
  readonly name: string;
  readObject(oid: Oid): Observable<GitObject>;
  writeObject(object: GitObject): Observable<GitObject>;
  exists(oid: Oid): Observable<boolean>;
}
