import type { IndexEntry, Oid } from "@slim-git/types";

/** Default file mode used for regular files staged into the index. */
export const DefaultFileMode = 0o100644;

/**
 * Creates an index entry from a workspace file.
 * Timestamps are set to the current time; device/inode fields are zeroed because
 * backends such as the memory implementation do not track real filesystem metadata.
 */
export const createIndexEntry = (path: string, oid: Oid, content: Uint8Array): IndexEntry => {
  const now = new Date();
  const timestampSeconds = Math.floor(now.getTime() / 1000);

  return {
    path,
    oid,
    mode: DefaultFileMode,
    stage: 0,
    fileSize: content.length,
    ctimeSeconds: timestampSeconds,
    ctimeNanos: 0,
    mtimeSeconds: timestampSeconds,
    mtimeNanos: 0,
    dev: 0,
    ino: 0,
    uid: 0,
    gid: 0,
    assumeValid: false,
    extended: false,
    skipWorktree: false,
    intentToAdd: false,
  };
};
