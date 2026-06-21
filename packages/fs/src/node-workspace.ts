import type { WorkspaceBackend } from "@slim-git/core";
import type { WorkspaceRemoveResult, WorkspaceWriteResult } from "@slim-git/types";
import { opendir, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { concatMap, from, map, type Observable } from "rxjs";

/**
 * Node.js filesystem implementation of `WorkspaceBackend`.
 *
 * All paths are treated as relative Unix-style paths inside the workspace root.
 * They are converted to platform paths at the filesystem boundary.
 */
export class NodeWorkspaceBackend implements WorkspaceBackend {
  readonly name = "node-workspace";

  constructor(private readonly root: string) {}

  readFile(path: string): Observable<Uint8Array> {
    return from(readFile(this.toAbsolute(path))).pipe(map((buffer) => new Uint8Array(buffer)));
  }

  writeFile(path: string, content: Uint8Array): Observable<WorkspaceWriteResult> {
    const absolute = this.toAbsolute(path);
    return from(mkdir(join(absolute, ".."), { recursive: true })).pipe(
      concatMap(() => from(writeFile(absolute, content))),
      map(() => ({ path })),
    );
  }

  removeFile(path: string): Observable<WorkspaceRemoveResult> {
    return from(rm(this.toAbsolute(path), { force: true })).pipe(map(() => ({ path })));
  }

  listFiles(): Observable<string[]> {
    return from(listFilesRecursive(this.root, this.root)).pipe(map((files) => files.sort()));
  }

  exists(path: string): Observable<boolean> {
    return from(fileExists(this.toAbsolute(path)));
  }

  /** Converts a workspace-relative Unix path to an absolute platform path. */
  private toAbsolute(path: string): string {
    return join(this.root, ...path.split("/"));
  }
}

/**
 * Recursively lists all files under `dir`, returning paths relative to `root`
 * as forward-slash strings.
 */
const listFilesRecursive = async (root: string, dir: string): Promise<string[]> => {
  const files: string[] = [];
  const entries = await opendir(dir);

  for await (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(root, absolute)));
    } else if (entry.isFile()) {
      files.push(toUnixPath(relative(root, absolute)));
    }
  }

  return files;
};

/** True if the given file exists and is readable. */
const fileExists = async (path: string): Promise<boolean> => {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
};

/** Converts a platform path to a forward-slash relative path. */
const toUnixPath = (path: string): string => path.split(sep).join("/");

/** Checks whether an unknown value is a Node.js ENOENT error. */
const isNotFoundError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
