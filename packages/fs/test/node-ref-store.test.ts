import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeRefStore } from "@slim-git/fs";

const withTempDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "slim-git-refs-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe("NodeRefStore", () => {
  test("reads and writes HEAD", async () => {
    await withTempDir(async (dir) => {
      const refs = new NodeRefStore(dir);

      await lastValueFrom(refs.write("HEAD", "ref: refs/heads/main"));

      expect(await lastValueFrom(refs.read("HEAD"))).toBe("ref: refs/heads/main");
    });
  });

  test("reads and writes branch refs", async () => {
    await withTempDir(async (dir) => {
      const refs = new NodeRefStore(dir);
      const oid = "abc123".repeat(5) + "abc1230";

      await lastValueFrom(refs.write("refs/heads/main", oid));

      expect(await lastValueFrom(refs.read("refs/heads/main"))).toBe(oid);
    });
  });

  test("returns undefined for missing refs", async () => {
    await withTempDir(async (dir) => {
      const refs = new NodeRefStore(dir);

      expect(await lastValueFrom(refs.read("refs/heads/missing"))).toBeUndefined();
    });
  });

  test("deletes refs", async () => {
    await withTempDir(async (dir) => {
      const refs = new NodeRefStore(dir);
      await lastValueFrom(refs.write("refs/heads/main", "abc"));

      await lastValueFrom(refs.delete("refs/heads/main"));

      expect(await lastValueFrom(refs.read("refs/heads/main"))).toBeUndefined();
    });
  });

  test("lists refs by prefix", async () => {
    await withTempDir(async (dir) => {
      const refs = new NodeRefStore(dir);
      await mkdir(join(dir, "refs", "heads"), { recursive: true });
      await mkdir(join(dir, "refs", "tags"), { recursive: true });
      await writeFile(join(dir, "refs", "heads", "main"), "oid-main\n");
      await writeFile(join(dir, "refs", "heads", "dev"), "oid-dev\n");
      await writeFile(join(dir, "refs", "tags", "v1"), "oid-v1\n");

      const branches = await lastValueFrom(refs.list("refs/heads/"));

      expect(branches).toEqual([
        { name: "refs/heads/dev", target: "oid-dev" },
        { name: "refs/heads/main", target: "oid-main" },
      ]);
    });
  });
});
