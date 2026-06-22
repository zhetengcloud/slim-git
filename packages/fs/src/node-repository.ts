import { Repository, type RepositoryOptions } from "@slim-git/core";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  catchError,
  concatMap,
  forkJoin,
  from,
  map,
  of,
  type Observable,
  throwError,
} from "rxjs";
import { isNodeNotFoundError } from "./node-utils.js";
import { NodeConfig } from "./node-config.js";
import { NodeIndexStore } from "./node-index-store.js";
import { NodeRefStore } from "./node-ref-store.js";
import { NodeStorageBackend } from "./node-storage.js";
import { NodeWorkspaceBackend } from "./node-workspace.js";

/** Options for creating or opening a Node filesystem-backed repository. */
export interface NodeRepositoryOptions extends RepositoryOptions {
  /** Initial branch name. Defaults to `main`. */
  readonly initialBranch?: string;
}

/**
 * Initializes a new repository on the Node.js filesystem.
 *
 * Creates `.git/`, the object/ref directories, HEAD, and a minimal config file,
 * then returns a `Repository` backed by Node filesystem implementations.
 */
export const initNodeRepository = (
  path: string,
  options: NodeRepositoryOptions = {},
): Observable<Repository> => {
  const gitDir = join(path, ".git");
  const branch = options.initialBranch ?? "main";
  const refs = new NodeRefStore(gitDir);
  const config = new NodeConfig(join(gitDir, "config"));

  return initializeGitDir$(gitDir).pipe(
    concatMap(() =>
      forkJoin([
        refs.write("HEAD", `ref: refs/heads/${branch}`),
        config.set("core", "repositoryformatversion", "0"),
        config.set("core", "filemode", "true"),
      ]),
    ),
    concatMap(() =>
      Repository.init(new NodeStorageBackend(gitDir), {
        ...options,
        refs,
        index: new NodeIndexStore(gitDir),
        workspace: new NodeWorkspaceBackend(path),
        config,
      }),
    ),
  );
};

/**
 * Opens an existing repository on the Node.js filesystem.
 *
 * Accepts either the working tree path or the `.git` directory itself.
 */
export const openNodeRepository = (
  path: string,
  options: RepositoryOptions = {},
): Observable<Repository> =>
  resolveGitDir$(path).pipe(
    map((gitDir) => ({
      gitDir,
      worktree: gitDir.endsWith("/.git") ? gitDir.slice(0, -5) : path,
    })),
    concatMap(({ gitDir, worktree }) =>
      Repository.open(new NodeStorageBackend(gitDir), {
        ...options,
        refs: new NodeRefStore(gitDir),
        index: new NodeIndexStore(gitDir),
        workspace: new NodeWorkspaceBackend(worktree),
        config: new NodeConfig(join(gitDir, "config")),
      }),
    ),
  );

/** Creates the standard `.git` subdirectories. */
const initializeGitDir$ = (gitDir: string): Observable<unknown> =>
  from(mkdir(join(gitDir, "objects"), { recursive: true })).pipe(
    concatMap(() => from(mkdir(join(gitDir, "refs", "heads"), { recursive: true }))),
    concatMap(() => from(mkdir(join(gitDir, "refs", "tags"), { recursive: true }))),
    map(() => ({})),
  );

/** Resolves the `.git` directory from a working tree or bare git path. */
const resolveGitDir$ = (path: string): Observable<string> => {
  const gitDir = join(path, ".git");

  return directoryExists$(gitDir).pipe(
    concatMap((hasGitDir) => {
      if (hasGitDir) return of(gitDir);
      return directoryExists$(path).pipe(
        concatMap((exists) =>
          exists ? of(path) : throwError(() => new Error(`Not a git repository: ${path}`)),
        ),
      );
    }),
  );
};

/** Emits true if `path` exists and is a directory. */
const directoryExists$ = (path: string): Observable<boolean> =>
  from(stat(path)).pipe(
    map((info) => info.isDirectory()),
    catchError((error) => {
      if (isNodeNotFoundError(error)) return of(false);
      return throwError(() => error);
    }),
  );
