import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeStorageBackend } from "@slim-git/fs";
import type { Oid } from "@slim-git/types";

const sampleOid = "3b18e512dba79e4c8300dd08aeb37f8e728b8dad" as Oid;
const zeroOid = "0000000000000000000000000000000000000000" as Oid;

const withTempDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "slim-git-storage-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe("NodeStorageBackend", () => {
  test("writes and reads a blob object", async () => {
    await withTempDir(async (dir) => {
      const storage = new NodeStorageBackend(dir);
      const content = new TextEncoder().encode("hello world");
      const object = { type: "blob" as const, content, oid: sampleOid };

      await lastValueFrom(storage.writeObject(object));

      const read = await lastValueFrom(storage.readObject(sampleOid));
      expect(read.type).toBe("blob");
      expect(read.content).toEqual(content);
      expect(read.oid).toBe(sampleOid);
    });
  });

  test("exists reports object presence", async () => {
    await withTempDir(async (dir) => {
      const storage = new NodeStorageBackend(dir);

      expect(await lastValueFrom(storage.exists(sampleOid))).toBe(false);

      await lastValueFrom(
        storage.writeObject({
          type: "blob",
          content: new TextEncoder().encode("hello world"),
          oid: sampleOid,
        }),
      );

      expect(await lastValueFrom(storage.exists(sampleOid))).toBe(true);
    });
  });

  test("readObject throws NotFoundError for missing objects", async () => {
    await withTempDir(async (dir) => {
      const storage = new NodeStorageBackend(dir);

      await expect(lastValueFrom(storage.readObject(zeroOid))).rejects.toThrow();
    });
  });

  test("produces canonical git loose-object paths", async () => {
    await withTempDir(async (dir) => {
      const storage = new NodeStorageBackend(dir);

      await lastValueFrom(
        storage.writeObject({
          type: "blob",
          content: new TextEncoder().encode("hello world"),
          oid: sampleOid,
        }),
      );

      const file = Bun.file(join(dir, "objects", "3b", "18e512dba79e4c8300dd08aeb37f8e728b8dad"));
      expect(await file.exists()).toBe(true);
    });
  });
});
