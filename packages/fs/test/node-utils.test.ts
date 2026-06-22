import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fileExists,
  isNodeNotFoundError,
  toUnixPath,
  writeFileEnsuringDir$,
} from "@slim-git/fs";
import { sep } from "node:path";

const withTempDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "slim-git-utils-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe("isNodeNotFoundError", () => {
  test("returns true for ENOENT errors", () => {
    expect(isNodeNotFoundError({ code: "ENOENT" })).toBe(true);
  });

  test("returns false for other codes", () => {
    expect(isNodeNotFoundError({ code: "EACCES" })).toBe(false);
  });

  test("returns false for non-objects", () => {
    expect(isNodeNotFoundError("ENOENT")).toBe(false);
    expect(isNodeNotFoundError(null)).toBe(false);
  });
});

describe("fileExists", () => {
  test("returns true for existing files", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "file");
      await writeFile(path, "hi");

      expect(await fileExists(path)).toBe(true);
    });
  });

  test("returns false for missing files", async () => {
    await withTempDir(async (dir) => {
      expect(await fileExists(join(dir, "missing"))).toBe(false);
    });
  });
});

describe("toUnixPath", () => {
  test("converts platform separators to forward slashes", () => {
    expect(toUnixPath(["a", "b", "c"].join(sep))).toBe("a/b/c");
  });

  test("leaves forward-slash paths unchanged", () => {
    expect(toUnixPath("a/b/c")).toBe("a/b/c");
  });
});

describe("writeFileEnsuringDir$", () => {
  test("creates nested directories and writes the file", async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "nested", "dir", "file.txt");

      await lastValueFrom(writeFileEnsuringDir$(path, "content"));

      const text = await (await import("node:fs/promises")).readFile(path, "utf-8");
      expect(text).toBe("content");
    });
  });
});
