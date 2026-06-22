import { describe, expect, test, beforeAll } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const slimGitDir = resolve(import.meta.dir, "..");
const slimGitDist = join(slimGitDir, "dist");

const bundledPackages = ["types", "core", "memory", "fs", "http"] as const;

const readText = async (path: string): Promise<string> => readFile(path, "utf-8");

describe("slim-git publish bundle", () => {
  beforeAll(async () => {
    if (!existsSync(slimGitDist)) {
      const result = spawnSync("bun", ["run", "build"], { cwd: slimGitDir });
      if (result.status !== 0) {
        throw new Error("`bun run build` failed before publish integration test.");
      }
    }
  });

  test("slim-git dist includes all workspace subpackages", () => {
    for (const pkg of bundledPackages) {
      expect(existsSync(join(slimGitDist, pkg, "index.js")), `${pkg}/index.js bundled`).toBe(true);
      expect(existsSync(join(slimGitDist, pkg, "index.d.ts")), `${pkg}/index.d.ts bundled`).toBe(true);
    }
  });

  test("slim-git entry has no @slim-git/* specifiers after bundling", async () => {
    const indexJs = await readText(join(slimGitDist, "index.js"));
    const indexDts = await readText(join(slimGitDist, "index.d.ts"));

    expect(indexJs).not.toMatch(/from\s+["']@slim-git\//);
    expect(indexDts).not.toMatch(/from\s+["']@slim-git\//);
  });

  test("slim-git entry imports bundled subpackages with relative paths", async () => {
    const indexJs = await readText(join(slimGitDist, "index.js"));

    expect(indexJs).toMatch(/from\s+["']\.\/types\/index\.js["']/);
    expect(indexJs).toMatch(/from\s+["']\.\/core\/index\.js["']/);
  });

  test("slim-git package.json has no workspace dependencies", async () => {
    const manifest = JSON.parse(await readFile(join(slimGitDir, "package.json"), "utf-8")) as Record<
      string,
      unknown
    >;
    const deps = (manifest.dependencies as Record<string, unknown>) ?? {};

    for (const key of Object.keys(deps)) {
      expect(key).not.toStartWith("@slim-git/");
    }
    expect(deps.rxjs).toBe("^7.8.1");
  });
});
