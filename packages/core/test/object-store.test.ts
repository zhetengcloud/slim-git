import type { Oid } from "@slim-git/types";
import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { MemoryBackend } from "@slim-git/memory";
import { ObjectStore, Sha1Hash, Sha256Hash } from "@slim-git/core";

describe("ObjectStore", () => {
  test("writes and reads an object", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const content = new TextEncoder().encode("hello world");

    const written = await lastValueFrom(store.write("blob", content));
    const read = await lastValueFrom(store.read(written.oid));

    expect(read.type).toBe("blob");
    expect(read.content).toEqual(content);
    expect(read.oid).toBe(written.oid);
  });

  test("exists returns true after write", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const written = await lastValueFrom(store.write("blob", new TextEncoder().encode("x")));

    expect(await lastValueFrom(store.exists(written.oid))).toBe(true);
  });

  test("exists returns false for unknown oid", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);

    expect(
      await lastValueFrom(store.exists("0000000000000000000000000000000000000000" as Oid)),
    ).toBe(false);
  });

  test("uses the configured hash algorithm", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha256Hash);
    const written = await lastValueFrom(store.write("blob", new TextEncoder().encode("hello\n")));

    expect(written.oid).toHaveLength(64);
  });
});
