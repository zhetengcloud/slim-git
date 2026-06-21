import { Repository, type RepositoryOptions } from "@slim-git/core";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { concatMap, from, lastValueFrom, map, type Observable } from "rxjs";
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

  return from(initializeGitDir(gitDir)).pipe(
    concatMap(() => {
      const refs = new NodeRefStore(gitDir);
      const config = new NodeConfig(join(gitDir, "config"));

      return from(
        Promise.all([
          lastValueFrom(refs.write("HEAD", `ref: refs/heads/${branch}`)),
          lastValueFrom(config.set("core", "repositoryformatversion", "0")),
          lastValueFrom(config.set("core", "filemode", "true")),
        ]),
      ).pipe(
        map(() =>
          Repository.init(new NodeStorageBackend(gitDir), {
            ...options,
            refs,
            index: new NodeIndexStore(gitDir),
            workspace: new NodeWorkspaceBackend(path),
            config,
          }),
        ),
      );
    }),
    concatMap((repo$) => repo$),
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
  from(resolveGitDir(path)).pipe(
    map((gitDir) => ({
      gitDir,
      worktree: gitDir.endsWith("/.git") ? gitDir.slice(0, -5) : path,
    })),
    map(({ gitDir, worktree }) =>
      Repository.open(new NodeStorageBackend(gitDir), {
        ...options,
        refs: new NodeRefStore(gitDir),
        index: new NodeIndexStore(gitDir),
        workspace: new NodeWorkspaceBackend(worktree),
        config: new NodeConfig(join(gitDir, "config")),
      }),
    ),
    concatMap((repo$) => repo$),
  );

/** Creates the standard `.git` subdirectories. */
const initializeGitDir = async (gitDir: string): Promise<void> => {
  await mkdir(join(gitDir, "objects"), { recursive: true });
  await mkdir(join(gitDir, "refs", "heads"), { recursive: true });
  await mkdir(join(gitDir, "refs", "tags"), { recursive: true });
};

/** Resolves the `.git` directory from a working tree or bare git path. */
const resolveGitDir = async (path: string): Promise<string> => {
  const gitDir = join(path, ".git");
  try {
    const info = await stat(gitDir);
    if (info.isDirectory()) return gitDir;
  } catch {
    // fall through
  }

  try {
    const info = await stat(path);
    if (info.isDirectory()) return path;
  } catch {
    // fall through
  }

  throw new Error(`Not a git repository: ${path}`);
};
