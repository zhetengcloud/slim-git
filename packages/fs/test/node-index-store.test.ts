import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Index } from "@slim-git/core";
import type { IndexEntry, Oid } from "@slim-git/types";
import { NodeIndexStore } from "@slim-git/fs";

const sampleOid = "3b18e512dba79e4c8300dd08aeb37f8e728b8dad" as Oid;

const createEntry = (path: string): IndexEntry => ({
  path,
  oid: sampleOid,
  mode: 0o100644,
  stage: 0,
  fileSize: 11,
  ctimeSeconds: 1,
  ctimeNanos: 0,
  mtimeSeconds: 2,
  mtimeNanos: 0,
  dev: 0,
  ino: 0,
  uid: 0,
  gid: 0,
  assumeValid: false,
  extended: false,
  skipWorktree: false,
  intentToAdd: false,
});

const withTempDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "slim-git-index-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe("NodeIndexStore", () => {
  test("returns an empty index when file does not exist", async () => {
    await withTempDir(async (dir) => {
      const store = new NodeIndexStore(dir);

      const index = await lastValueFrom(store.read());

      expect(index.paths).toEqual([]);
    });
  });

  test("writes and reads index entries", async () => {
    await withTempDir(async (dir) => {
      const store = new NodeIndexStore(dir);
      const index = Index.from([createEntry("README.md"), createEntry("src/index.ts")]);

      await lastValueFrom(store.write(index));
      const read = await lastValueFrom(store.read());

      expect(read.paths).toEqual(["README.md", "src/index.ts"]);
      expect(read.get("README.md")?.oid).toBe(sampleOid);
      expect(read.get("src/index.ts")?.mode).toBe(0o100644);
    });
  });

  test("write result reports entry count", async () => {
    await withTempDir(async (dir) => {
      const store = new NodeIndexStore(dir);
      const index = Index.from([createEntry("a.txt")]);

      const result = await lastValueFrom(store.write(index));

      expect(result).toEqual({ entries: 1 });
    });
  });
});
