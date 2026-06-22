import type { WorkspaceBackend } from "@slim-git/core";
import type { WorkspaceRemoveResult, WorkspaceWriteResult } from "@slim-git/types";
import { opendir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { EMPTY, expand, filter, from, map, mergeMap, type Observable, of, toArray } from "rxjs";
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
    return listFilesRecursive$(this.root).pipe(
      toArray(),
      map((files) => files.sort()),
    );
  }

  exists(path: string): Observable<boolean> {
    return fileExists$(this.toAbsolute(path));
  }

  /** Converts a workspace-relative Unix path to an absolute platform path. */
  private toAbsolute(path: string): string {
    return join(this.root, ...path.split("/"));
  }
}

/** A node in the recursive directory traversal. */
type TreeNode =
  | { readonly kind: "dir"; readonly path: string }
  | { readonly kind: "file"; readonly path: string };

/**
 * Recursively lists all files under `root`, returning paths relative to `root`
 * as forward-slash strings.
 *
 * Uses `expand` to walk the directory tree declaratively: directories are
 * expanded into their entries, and subdirectories are fed back for further
 * expansion until only file paths remain.
 */
const listFilesRecursive$ = (root: string): Observable<string> =>
  of<TreeNode>({ kind: "dir", path: root }).pipe(
    expand((node) =>
      node.kind === "file"
        ? EMPTY
        : from(opendir(node.path)).pipe(
            mergeMap((dir) => from(dir)),
            map((entry) => {
              const absolute = join(node.path, entry.name);
              return entry.isDirectory()
                ? ({ kind: "dir" as const, path: absolute })
                : ({ kind: "file" as const, path: toUnixPath(relative(root, absolute)) });
            }),
          ),
    ),
    filter((node): node is Extract<TreeNode, { kind: "file" }> => node.kind === "file"),
    map((node) => node.path),
  );

