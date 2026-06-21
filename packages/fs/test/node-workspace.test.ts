import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeWorkspaceBackend } from "@slim-git/fs";

const withTempDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "slim-git-fs-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe("NodeWorkspaceBackend", () => {
  test("writeFile creates nested files", async () => {
    await withTempDir(async (dir) => {
      const workspace = new NodeWorkspaceBackend(dir);
      const content = new TextEncoder().encode("hello");

      await lastValueFrom(workspace.writeFile("a/b/c.txt", content));

      const bytes = await lastValueFrom(workspace.readFile("a/b/c.txt"));
      expect(new TextDecoder().decode(bytes)).toBe("hello");
    });
  });

  test("readFile throws for missing files", async () => {
    await withTempDir(async (dir) => {
      const workspace = new NodeWorkspaceBackend(dir);

      await expect(lastValueFrom(workspace.readFile("missing.txt"))).rejects.toThrow();
    });
  });

  test("removeFile deletes a file", async () => {
    await withTempDir(async (dir) => {
      const workspace = new NodeWorkspaceBackend(dir);
      await writeFile(join(dir, "file.txt"), "content");

      await lastValueFrom(workspace.removeFile("file.txt"));

      await expect(lastValueFrom(workspace.exists("file.txt"))).resolves.toBe(false);
    });
  });

  test("removeFile is idempotent", async () => {
    await withTempDir(async (dir) => {
      const workspace = new NodeWorkspaceBackend(dir);

      await expect(lastValueFrom(workspace.removeFile("missing.txt"))).resolves.toEqual({
        path: "missing.txt",
      });
    });
  });

  test("listFiles returns all files recursively", async () => {
    await withTempDir(async (dir) => {
      const workspace = new NodeWorkspaceBackend(dir);
      await mkdir(join(dir, "nested"), { recursive: true });
      await writeFile(join(dir, "top.txt"), "top");
      await writeFile(join(dir, "nested", "bottom.txt"), "bottom");

      const files = await lastValueFrom(workspace.listFiles());

      expect(files).toEqual(["nested/bottom.txt", "top.txt"]);
    });
  });

  test("exists reports file presence", async () => {
    await withTempDir(async (dir) => {
      const workspace = new NodeWorkspaceBackend(dir);
      await writeFile(join(dir, "present.txt"), "yes");

      expect(await lastValueFrom(workspace.exists("present.txt"))).toBe(true);
      expect(await lastValueFrom(workspace.exists("absent.txt"))).toBe(false);
    });
  });
});
