import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initNodeRepository, openNodeRepository } from "@slim-git/fs";

const withTempDir = async <T>(fn: (dir: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "slim-git-repo-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

const person = {
  name: "Test",
  email: "test@example.com",
  timestamp: new Date(),
  timezoneOffsetMinutes: 0,
};

describe("Node repository", () => {
  test("initNodeRepository creates .git and commits round-trip", async () => {
    await withTempDir(async (dir) => {
      const repo = await lastValueFrom(initNodeRepository(dir));

      await lastValueFrom(repo.workspace.writeFile("hello.txt", new TextEncoder().encode("world")));
      await lastValueFrom(repo.add(["hello.txt"]));
      const oid = await lastValueFrom(repo.commit({ message: "first", author: person }));

      const reopened = await lastValueFrom(openNodeRepository(dir));
      const head = await lastValueFrom(reopened.resolveRef("HEAD"));

      expect(head).toBe(oid);
    });
  });

  test("openNodeRepository returns the current branch", async () => {
    await withTempDir(async (dir) => {
      await lastValueFrom(initNodeRepository(dir, { initialBranch: "trunk" }));

      const repo = await lastValueFrom(openNodeRepository(dir));

      expect(await lastValueFrom(repo.getCurrentBranch())).toBe("trunk");
    });
  });
});
