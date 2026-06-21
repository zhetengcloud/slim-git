import { describe, expect, test } from "bun:test";
import type { Oid } from "@slim-git/types";
import { defaultIfEmpty, forkJoin, lastValueFrom } from "rxjs";
import { createMemoryRepository } from "@slim-git/memory";
import type { Repository } from "@slim-git/core";

const person = {
  name: "Dev",
  email: "dev@example.com",
  timestamp: new Date(0),
  timezoneOffsetMinutes: 0,
};

const setupRepo = async (files: Record<string, string>): Promise<Repository> => {
  const repo = await lastValueFrom(createMemoryRepository());
  await lastValueFrom(
    forkJoin(
      Object.entries(files).map(([path, content]) =>
        repo.workspace.writeFile(path, new TextEncoder().encode(content)),
      ),
    ).pipe(defaultIfEmpty([])),
  );
  return repo;
};

const commitFile = async (
  repo: Repository,
  path: string,
  content: string,
  message: string,
): Promise<void> => {
  await lastValueFrom(repo.workspace.writeFile(path, new TextEncoder().encode(content)));
  await lastValueFrom(repo.add([path]));
  await lastValueFrom(repo.commit({ message, author: person }));
};

describe("Repository checkout", () => {
  test("checkout branch updates HEAD symbolically", async () => {
    const repo = await setupRepo({});
    await commitAndGetOid(repo, "a.txt", "a", "First");
    await lastValueFrom(repo.createBranch("topic"));
    await lastValueFrom(repo.checkout("topic"));

    expect(await lastValueFrom(repo.refs.read("HEAD"))).toBe("ref: refs/heads/topic");
    expect(await lastValueFrom(repo.getCurrentBranch())).toBe("topic");
  });

  test("checkout oid detaches HEAD", async () => {
    const repo = await setupRepo({});
    const first = await commitAndGetOid(repo, "a.txt", "a", "First");
    await commitFile(repo, "b.txt", "b", "Second");

    await lastValueFrom(repo.checkout(first));

    expect(await lastValueFrom(repo.refs.read("HEAD"))).toBe(first);
    expect(await lastValueFrom(repo.workspace.exists("b.txt"))).toBe(false);
    expect(await lastValueFrom(repo.workspace.exists("a.txt"))).toBe(true);
  });

  test("checkout updates workspace and index", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    await lastValueFrom(repo.createBranch("main"));
    await lastValueFrom(repo.createBranch("topic"));
    await lastValueFrom(repo.checkout("topic"));
    await commitFile(repo, "b.txt", "b", "Second on topic");
    await lastValueFrom(repo.checkout("main"));

    expect(await lastValueFrom(repo.workspace.exists("b.txt"))).toBe(false);
    const content = new TextDecoder().decode(await lastValueFrom(repo.workspace.readFile("a.txt")));
    expect(content).toBe("a");
    const status = await lastValueFrom(repo.status());
    expect(status.staged).toEqual([]);
    expect(status.untracked).toEqual([]);
  });
});

const commitAndGetOid = async (
  repo: Repository,
  path: string,
  content: string,
  message: string,
): Promise<Oid> => {
  await commitFile(repo, path, content, message);
  const oid = await lastValueFrom(repo.refs.read("HEAD"));
  if (oid === undefined) {
    throw new Error("Expected HEAD after commit");
  }
  return oid as Oid;
};
