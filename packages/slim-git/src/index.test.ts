import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { initRepository, MemoryBackend, openRepository, Sha256Hash } from "./index.js";

describe("slim-git SDK", () => {
  test("initRepository returns a repository with default SHA-1", async () => {
    const repo = await lastValueFrom(initRepository(new MemoryBackend()));

    expect(repo.hashAlgorithm.name).toBe("sha1");
    expect(repo.backend.name).toBe("memory");
  });

  test("openRepository accepts a custom hash algorithm", async () => {
    const repo = await lastValueFrom(openRepository(new MemoryBackend(), { hash: Sha256Hash }));

    expect(repo.hashAlgorithm.name).toBe("sha256");
  });

  test("repository writes and reads objects", async () => {
    const repo = await lastValueFrom(initRepository(new MemoryBackend()));
    const content = new TextEncoder().encode("slim-git");

    const written = await lastValueFrom(repo.objectStore.write("blob", content));
    const read = await lastValueFrom(repo.objectStore.read(written.oid));

    expect(read.content).toEqual(content);
  });
});
