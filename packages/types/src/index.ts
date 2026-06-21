/** Git object types supported by slim-git. */
export const ObjectTypes = ["blob", "tree", "commit", "tag"] as const;

/** Union of the supported Git object types. */
export type ObjectType = (typeof ObjectTypes)[number];

/**
 * Branded string representing a Git object id (SHA-1 or SHA-256 hex digest).
 * The brand prevents accidentally passing an arbitrary string where an oid is expected.
 */
export type Oid = string & { readonly __brand: "Oid" };

/** Hash algorithms supported for object ids. */
export type HashAlgorithmName = "sha1" | "sha256";

/** A Git object as stored in the object database. */
export interface GitObject {
  readonly type: ObjectType;
  readonly content: Uint8Array;
  readonly oid: Oid;
}

/** A Git reference (e.g. HEAD, refs/heads/main). */
export interface Ref {
  readonly name: string;
  readonly target: string;
}

/** Identifying information for an author or committer. */
export interface Person {
  readonly name: string;
  readonly email: string;
  readonly timestamp: Date;
  readonly timezoneOffsetMinutes: number;
}

/**
 * A single entry in the Git index (staging area).
 * Mirrors the fields Git stores for each cached path.
 */
export interface IndexEntry {
  readonly path: string;
  readonly oid: Oid;
  readonly mode: number;
  readonly stage: number;
  readonly fileSize: number;
  readonly ctimeSeconds: number;
  readonly ctimeNanos: number;
  readonly mtimeSeconds: number;
  readonly mtimeNanos: number;
  readonly dev: number;
  readonly ino: number;
  readonly uid: number;
  readonly gid: number;
  readonly assumeValid: boolean;
  readonly extended: boolean;
  readonly skipWorktree: boolean;
  readonly intentToAdd: boolean;
}

/** A single entry inside a Git tree object. */
export interface TreeEntry {
  readonly mode: number;
  readonly name: string;
  readonly oid: Oid;
}

/** Parsed contents of a Git commit object. */
export interface CommitInfo {
  readonly tree: Oid;
  readonly parents: readonly Oid[];
  readonly author: Person;
  readonly committer: Person;
  readonly message: string;
}

/** Result of comparing the workspace to the index and HEAD. */
export interface Status {
  readonly staged: string[];
  readonly modified: string[];
  readonly deleted: string[];
  readonly untracked: string[];
}

/** Base class for all slim-git errors. */
export class SlimGitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Thrown when a requested object, ref, or file cannot be found. */
export class NotFoundError extends SlimGitError {
  constructor(what: string) {
    super(`Not found: ${what}`);
  }
}

/** Thrown when an operation is requested that slim-git does not support. */
export class UnsupportedError extends SlimGitError {
  constructor(what: string) {
    super(`Unsupported: ${what}`);
  }
}

/** Thrown when an operation encounters a conflict that cannot be resolved automatically. */
export class ConflictError extends SlimGitError {
  constructor(what: string) {
    super(`Conflict: ${what}`);
  }
}
