import type { Oid } from "@slim-git/types";
import { describe, expect, test } from "bun:test";
import { NotFoundError, Sha1Hash } from "@slim-git/core";
import { MemoryBackend } from "./index.js";

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
