import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, sep } from "node:path";
import { concatMap, from, type Observable } from "rxjs";

/**
 * Checks whether an unknown value is a Node.js ENOENT error.
 *
 * Used to distinguish "file not found" from real filesystem failures when
 * catching errors from `node:fs/promises`.
 */
export const isNodeNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code: unknown }).code === "ENOENT";

/**
 * True if the file at `path` exists and is readable.
 *
 * Returns `false` for missing files without throwing.
 */
export const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isNodeNotFoundError(error)) return false;
    throw error;
  }
};

/**
 * Converts a platform-specific path to a forward-slash relative path.
 *
 * Git stores paths with `/` separators regardless of the host OS.
 */
export const toUnixPath = (path: string): string => path.split(sep).join("/");

/**
 * Writes `content` to `path`, creating any missing parent directories first.
 *
 * Encapsulates the common `mkdir(..., { recursive: true })` followed by
 * `writeFile(...)` pattern used by the Node filesystem backends.
 */
export const writeFileEnsuringDir$ = (
  path: string,
  content: string | Uint8Array,
): Observable<void> =>
  from(mkdir(dirname(path), { recursive: true })).pipe(
    concatMap(() => from(writeFile(path, content))),
  );
