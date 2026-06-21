import type { Oid } from "@slim-git/types";
import { describe, expect, test } from "bun:test";
import { Index, NotFoundError, Sha1Hash } from "@slim-git/core";
import {
  MemoryBackend,
  MemoryIndexStore,
  MemoryRefStore,
  MemoryWorkspaceBackend,
} from "./index.js";

describe("MemoryBackend", () => {
  test("stores and retrieves objects", async () => {
    const backend = new MemoryBackend();
    const object = Sha1Hash.hashObject("blob", new TextEncoder().encode("data"));

    await backend.writeObject(object);
    const read = await backend.readObject(object.oid);

    expect(read.oid).toBe(object.oid);
    expect(read.type).toBe("blob");
    expect(read.content).toEqual(object.content);
  });

  test("throws NotFoundError for missing objects", async () => {
    const backend = new MemoryBackend();

    await expect(
      backend.readObject("0000000000000000000000000000000000000000" as Oid),
    ).rejects.toThrow(NotFoundError);
  });

  test("reports existence correctly", async () => {
    const backend = new MemoryBackend();
    const object = Sha1Hash.hashObject("blob", new TextEncoder().encode("x"));

    expect(await backend.exists(object.oid)).toBe(false);
    await backend.writeObject(object);
    expect(await backend.exists(object.oid)).toBe(true);
  });
});

describe("MemoryRefStore", () => {
  test("writes and reads refs", async () => {
    const refs = new MemoryRefStore();
    await refs.write("HEAD", "abc123");

    expect(await refs.read("HEAD")).toBe("abc123");
  });

  test("lists refs by prefix", async () => {
    const refs = new MemoryRefStore();
    await refs.write("refs/heads/main", "a");
    await refs.write("refs/heads/dev", "b");
    await refs.write("refs/tags/v1", "c");

    const branches = await refs.list("refs/heads/");
    expect(branches.map((r) => r.name)).toEqual(["refs/heads/dev", "refs/heads/main"]);
  });
});

describe("MemoryIndexStore", () => {
  test("persists an index", async () => {
    const store = new MemoryIndexStore();
    const index = Index.empty().add({
      path: "a.txt",
      oid: "oid1" as Oid,
      mode: 0o100644,
      stage: 0,
      fileSize: 0,
      ctimeSeconds: 0,
      ctimeNanos: 0,
      mtimeSeconds: 0,
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

    await store.write(index);
    const read = await store.read();

    expect(read.has("a.txt")).toBe(true);
  });
});

describe("MemoryWorkspaceBackend", () => {
  test("writes and reads files", async () => {
    const workspace = new MemoryWorkspaceBackend();
    await workspace.writeFile("a.txt", new TextEncoder().encode("hello"));

    const content = new TextDecoder().decode(await workspace.readFile("a.txt"));
    expect(content).toBe("hello");
  });

  test("lists files", async () => {
    const workspace = new MemoryWorkspaceBackend();
    await workspace.writeFile("b.txt", new TextEncoder().encode("b"));
    await workspace.writeFile("a.txt", new TextEncoder().encode("a"));

    expect(await workspace.listFiles()).toEqual(["a.txt", "b.txt"]);
  });
});
