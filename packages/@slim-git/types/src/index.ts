export const ObjectTypes = ['blob', 'tree', 'commit', 'tag'] as const;

export type ObjectType = (typeof ObjectTypes)[number];

export type Oid = string & { readonly __brand: 'Oid' };

export type HashAlgorithmName = 'sha1' | 'sha256';

export interface GitObject {
  readonly type: ObjectType;
  readonly content: Uint8Array;
  readonly oid: Oid;
}

export interface Ref {
  readonly name: string;
  readonly target: string;
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
