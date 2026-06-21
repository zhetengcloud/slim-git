export const ObjectTypes = ["blob", "tree", "commit", "tag"] as const;

export type ObjectType = (typeof ObjectTypes)[number];

export type Oid = string & { readonly __brand: "Oid" };

export type HashAlgorithmName = "sha1" | "sha256";

export interface GitObject {
  readonly type: ObjectType;
  readonly content: Uint8Array;
  readonly oid: Oid;
}

export interface Ref {
  readonly name: string;
  readonly target: string;
}

export interface Person {
  readonly name: string;
  readonly email: string;
  readonly timestamp: Date;
  readonly timezoneOffsetMinutes: number;
}

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

export interface TreeEntry {
  readonly mode: number;
  readonly name: string;
  readonly oid: Oid;
}

export interface CommitInfo {
  readonly tree: Oid;
  readonly parents: readonly Oid[];
  readonly author: Person;
  readonly committer: Person;
  readonly message: string;
}

export interface Status {
  readonly staged: string[];
  readonly modified: string[];
  readonly deleted: string[];
  readonly untracked: string[];
}

export class SlimGitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends SlimGitError {
  constructor(what: string) {
    super(`Not found: ${what}`);
  }
}

export class UnsupportedError extends SlimGitError {
  constructor(what: string) {
    super(`Unsupported: ${what}`);
  }
}

export class ConflictError extends SlimGitError {
  constructor(what: string) {
    super(`Conflict: ${what}`);
  }
}
