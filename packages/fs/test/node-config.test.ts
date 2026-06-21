import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeConfig } from "@slim-git/fs";

const withTempFile = async <T>(fn: (path: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "slim-git-config-"));
  const path = join(dir, "config");
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe("NodeConfig", () => {
  test("reads flat section values", async () => {
    await withTempFile(async (path) => {
      await writeFile(path, "[core]\n\trepositoryformatversion = 0\n");
      const config = new NodeConfig(path);

      const value = await lastValueFrom(config.get("core", "repositoryformatversion"));

      expect(value).toBe("0");
    });
  });

  test("reads subsection values", async () => {
    await withTempFile(async (path) => {
      await writeFile(
        path,
        '[remote "origin"]\n\turl = https://example.com/repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
      );
      const config = new NodeConfig(path);

      const url = await lastValueFrom(config.get("remote", "origin.url"));
      const fetch = await lastValueFrom(config.get("remote", "origin.fetch"));

      expect(url).toBe("https://example.com/repo.git");
      expect(fetch).toBe("+refs/heads/*:refs/remotes/origin/*");
    });
  });

  test("writes values and persists them", async () => {
    await withTempFile(async (path) => {
      const config = new NodeConfig(path);

      await lastValueFrom(config.set("core", "bare", "true"));
      await lastValueFrom(config.set("remote", "origin.url", "https://example.com/repo.git"));

      const text = await readFile(path, "utf-8");
      expect(text).toContain("[core]");
      expect(text).toContain("bare = true");
      expect(text).toContain('[remote "origin"]');
      expect(text).toContain("url = https://example.com/repo.git");

      const reloaded = new NodeConfig(path);
      expect(await lastValueFrom(reloaded.get("core", "bare"))).toBe("true");
      expect(await lastValueFrom(reloaded.get("remote", "origin.url"))).toBe(
        "https://example.com/repo.git",
      );
    });
  });

  test("removes values", async () => {
    await withTempFile(async (path) => {
      const config = new NodeConfig(path);
      await lastValueFrom(config.set("core", "bare", "true"));

      await lastValueFrom(config.remove("core", "bare"));

      expect(await lastValueFrom(config.get("core", "bare"))).toBeUndefined();
    });
  });

  test("lists section entries", async () => {
    await withTempFile(async (path) => {
      const config = new NodeConfig(path);
      await lastValueFrom(config.set("remote", "origin.url", "https://origin.git"));
      await lastValueFrom(config.set("remote", "upstream.url", "https://upstream.git"));

      const entries = await lastValueFrom(config.list("remote"));

      expect(entries).toEqual([
        ["origin.url", "https://origin.git"],
        ["upstream.url", "https://upstream.git"],
      ]);
    });
  });

  test("ignores comments", async () => {
    await withTempFile(async (path) => {
      await writeFile(path, "# comment\n[core]\n\t bare = false ; inline\n");
      const config = new NodeConfig(path);

      expect(await lastValueFrom(config.get("core", "bare"))).toBe("false");
    });
  });
});
