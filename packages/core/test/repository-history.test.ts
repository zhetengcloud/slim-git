import { describe, expect, test } from "bun:test";
import type { Oid } from "@slim-git/types";
import { defaultIfEmpty, forkJoin, lastValueFrom, toArray } from "rxjs";
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

describe("Repository history", () => {
  test("log walks commits from HEAD", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    await commitFile(repo, "b.txt", "b", "Second");

    const commits = await lastValueFrom(repo.log().pipe(toArray()));

    expect(commits).toHaveLength(2);
    expect(commits[0]!.message).toBe("Second");
    expect(commits[1]!.message).toBe("First");
  });

  test("log can start from a branch", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    const second = await commitAndGetOid(repo, "b.txt", "b", "Second");
    await lastValueFrom(repo.createBranch("topic", { target: second }));
    await commitFile(repo, "c.txt", "c", "Third on main");

    const commits = await lastValueFrom(repo.log({ ref: "topic" }).pipe(toArray()));

    expect(commits).toHaveLength(2);
    expect(commits[0]!.message).toBe("Second");
    expect(commits[1]!.message).toBe("First");
  });

  test("log deduplicates shared parents", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "base.txt", "base", "Base");
    const base = await lastValueFrom(repo.refs.read("HEAD"));
    await lastValueFrom(repo.createBranch("a", { target: base }));
    await lastValueFrom(repo.createBranch("b", { target: base }));
    await lastValueFrom(repo.checkout("a"));
    await commitFile(repo, "a.txt", "a", "A");
    await lastValueFrom(repo.checkout("b"));
    await commitFile(repo, "b.txt", "b", "B");

    // Merge the two branches manually by creating a commit with both parents.
    await lastValueFrom(repo.workspace.writeFile("a.txt", new TextEncoder().encode("a")));
    await lastValueFrom(repo.workspace.writeFile("b.txt", new TextEncoder().encode("b")));
    await lastValueFrom(repo.add(["a.txt", "b.txt"]));
    await lastValueFrom(repo.commit({ message: "Merge", author: person }));

    const commits = await lastValueFrom(repo.log().pipe(toArray()));
    const messages = commits.map((c) => c.message);

    expect(messages.filter((m) => m === "Base")).toHaveLength(1);
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
