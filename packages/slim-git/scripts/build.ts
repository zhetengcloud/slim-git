#!/usr/bin/env bun
/**
 * Builds the `slim-git` package as a self-contained bundle.
 *
 * 1. Builds all workspace packages to their own dist/ folders.
 * 2. Builds slim-git's own source to packages/slim-git/dist/.
 * 3. Copies each workspace dist into packages/slim-git/dist/<pkg-name>/.
 * 4. Rewrites `@slim-git/*` specifiers in the emitted JS and d.ts files to
 *    relative paths so the published package needs no scoped dependencies.
 */
import { existsSync } from "node:fs";
import { cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const slimGitDir = resolve(import.meta.dir, "..");
const slimGitDist = join(slimGitDir, "dist");
const rootDir = resolve(slimGitDir, "../..");
const packagesDir = join(rootDir, "packages");

const bundledPackages = ["types", "core", "memory", "fs", "http"] as const;

const exec = (command: string, args: string[], cwd: string): void => {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
};

const buildWorkspacePackages = (): void => {
  console.log("Building workspace packages...");
  exec("bun", ["run", "--filter", "!slim-git", "build"], rootDir);
};

const buildSlimGitSource = (): void => {
  console.log("Building slim-git source...");
  exec("tsc", ["-p", "tsconfig.build.json"], slimGitDir);
};

const copyPackageDist = async (pkgName: string): Promise<void> => {
  const sourceDir = join(packagesDir, pkgName, "dist");
  const targetDir = join(slimGitDist, pkgName);
  if (!existsSync(sourceDir)) {
    throw new Error(`Missing dist for ${pkgName}. Build workspace packages first.`);
  }
  await rm(targetDir, { recursive: true, force: true });
  await cp(sourceDir, targetDir, { recursive: true });
};

const bundleWorkspaceDists = async (): Promise<void> => {
  console.log("Bundling workspace dists into slim-git/dist...");
  for (const pkgName of bundledPackages) {
    await copyPackageDist(pkgName);
  }
};

/**
 * Maps a `@slim-git/<pkg>` specifier to a relative path rooted in the file's
 * directory inside `slim-git/dist`.
 */
const rewriteSpecifier = (specifier: string, currentDirDepth: number): string => {
  const prefix = "@slim-git/";
  if (!specifier.startsWith(prefix)) {
    return specifier;
  }
  const rest = specifier.slice(prefix.length);
  const slashIndex = rest.indexOf("/");
  const pkgName = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
  const subpath = slashIndex === -1 ? "" : rest.slice(slashIndex + 1);

  if (!bundledPackages.includes(pkgName as (typeof bundledPackages)[number])) {
    return specifier;
  }

  const up = Array(currentDirDepth).fill("..").join("/");
  const base = currentDirDepth === 0 ? `./${pkgName}` : `${up}/${pkgName}`;
  return subpath ? `${base}/${subpath}` : `${base}/index.js`;
};

const rewriteImportsInFile = async (path: string, currentDirDepth: number): Promise<void> => {
  const content = await readFile(path, "utf-8");
  const rewritten = content.replace(
    /from\s+["'](@slim-git\/[^"']+)["']/g,
    (_, specifier) => `from "${rewriteSpecifier(specifier, currentDirDepth)}"`,
  );
  if (rewritten !== content) {
    await writeFile(path, rewritten, "utf-8");
  }
};

const getRelativeDepth = (filePath: string, baseDir: string): number => {
  const relativePath = filePath.slice(baseDir.length + 1);
  return relativePath.split("/").length - 1;
};

const rewriteAllImports = async (): Promise<void> => {
  console.log("Rewriting workspace imports to relative paths...");
  const files = await collectFiles(slimGitDist);
  for (const file of files) {
    if (file.endsWith(".js") || file.endsWith(".d.ts")) {
      const depth = getRelativeDepth(file, slimGitDist);
      await rewriteImportsInFile(file, depth);
    }
  }
};

const collectFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files;
};

const main = async (): Promise<void> => {
  await rm(slimGitDist, { recursive: true, force: true });
  buildWorkspacePackages();
  buildSlimGitSource();
  await bundleWorkspaceDists();
  await rewriteAllImports();
  console.log("slim-git bundle ready at packages/slim-git/dist");
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
