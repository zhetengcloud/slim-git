/** Git object types supported by slim-git. */
export const ObjectTypes = ["blob", "tree", "commit", "tag"] as const;

/** Union of the supported Git object types. */
export type ObjectType = (typeof ObjectTypes)[number];

/**
 * Branded string representing a Git object id (SHA-1 or SHA-256 hex digest).
 * The brand prevents accidentally passing an arbitrary string where an oid is expected.
 */
export type Oid = string & { readonly __brand: "Oid" };

/** Hash algorithm identifiers supported for object ids. */
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
  readonly oid: Oid;
  readonly tree: Oid;
  readonly parents: readonly Oid[];
  readonly author: Person;
  readonly committer: Person;
  readonly message: string;
}

/** Options for `Repository.log()`. */
export interface LogOptions {
  /** Ref name or oid to start from. Defaults to HEAD. */
  readonly ref?: string;
}

/** A branch (refs/heads/*). */
export interface Branch {
  readonly name: string;
  readonly target: Oid;
}

/** A lightweight tag (refs/tags/*). */
export interface Tag {
  readonly name: string;
  readonly target: Oid;
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

/** Result returned by ref write operations. */
export interface RefWriteResult {
  readonly ref: string;
  readonly target: string;
}

/** Result returned by ref delete operations. */
export interface RefDeleteResult {
  readonly ref: string;
}

/** Result returned by index write operations. */
export interface IndexWriteResult {
  readonly entries: number;
}

/** Result returned by workspace file write operations. */
export interface WorkspaceWriteResult {
  readonly path: string;
}

/** Result returned by workspace file remove operations. */
export interface WorkspaceRemoveResult {
  readonly path: string;
}

/** Result of staging files. */
export interface AddResult {
  readonly added: readonly string[];
}

/** Result of removing files from workspace and index. */
export interface RemoveResult {
  readonly removed: readonly string[];
}

/** Result of restoring workspace files from the index. */
export interface RestoreResult {
  readonly restored: readonly string[];
}

/** Result of creating a branch. */
export interface CreateBranchResult {
  readonly name: string;
  readonly target: Oid;
}

/** Result of deleting a branch. */
export interface DeleteBranchResult {
  readonly name: string;
}

/** Result of checking out a branch or commit. */
export interface CheckoutResult {
  readonly commitOid: Oid;
  readonly branch?: string;
}

/** Result of creating a tag. */
export interface CreateTagResult {
  readonly name: string;
  readonly target: Oid;
}

/** Result of deleting a tag. */
export interface DeleteTagResult {
  readonly name: string;
}

/** Result of releasing repository resources. */
export interface DestroyResult {
  readonly destroyed: true;
}

/** Result of a line-level diff between two trees. */
export interface Diff {
  readonly files: readonly FileDiff[];
}

/** Per-file diff result. */
export interface FileDiff {
  readonly path: string;
  readonly status: "added" | "deleted" | "modified" | "renamed" | "unchanged";
  readonly oldPath?: string;
  readonly hunks: readonly Hunk[];
}

/** A single hunk inside a file diff. */
export interface Hunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

/** A single line inside a diff hunk. */
export interface DiffLine {
  readonly type: "context" | "added" | "removed";
  readonly text: string;
}

/** A configured remote repository. */
export interface Remote {
  readonly name: string;
  readonly url: string;
  /** Optional URL used only for pushing (Git's `remote.<name>.pushurl`). */
  readonly pushUrl?: string;
}

/** Result of a successful merge. */
export interface MergeSuccessResult {
  readonly merged: true;
  readonly commitOid: Oid;
}

/** A single path that could not be merged automatically. */
export interface MergeConflict {
  readonly path: string;
  readonly content: Uint8Array;
}

/** Result of a merge: either a success or a list of conflicts. */
export type MergeResult =
  | MergeSuccessResult
  | { readonly merged: false; readonly conflicts: readonly MergeConflict[] };

/** Result of a fetch operation. */
export interface FetchResult {
  readonly fetched: readonly { readonly ref: string; readonly oid: Oid }[];
}

/** Result of a push operation. */
export interface PushResult {
  readonly pushed: readonly {
    readonly ref: string;
    readonly oid: Oid;
    readonly accepted: boolean;
  }[];
}

/** Result of a pull operation. */
export interface PullResult {
  readonly fetch: FetchResult;
  readonly merge: MergeResult;
}
