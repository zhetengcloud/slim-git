import type { WorkspaceBackend } from "@slim-git/core";
import type { WorkspaceRemoveResult, WorkspaceWriteResult } from "@slim-git/types";
import { opendir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { from, map, type Observable } from "rxjs";
import { fileExists$, toUnixPath, writeFileEnsuringDir$ } from "./node-utils.js";

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
    return writeFileEnsuringDir$(this.toAbsolute(path), content).pipe(
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
    return fileExists$(this.toAbsolute(path));
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

