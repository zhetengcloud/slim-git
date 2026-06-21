import { describe, expect, test } from "bun:test";
import { defaultIfEmpty, forkJoin, lastValueFrom } from "rxjs";
import { createMemoryRepository } from "@slim-git/memory";
import { findMergeBase$ } from "@slim-git/core";
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

describe("findMergeBase$", () => {
  test("returns the same oid for identical commits", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    const head = await lastValueFrom(repo.resolveRef("HEAD"));

    const base = await lastValueFrom(findMergeBase$(repo, head!, head!));

    expect(base).toBe(head);
  });

  test("finds the common parent of diverged branches", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "Root");
    const root = await lastValueFrom(repo.resolveRef("HEAD"));
    await lastValueFrom(repo.createBranch("main"));
    await lastValueFrom(repo.checkout("main"));
    await lastValueFrom(repo.createBranch("topic"));
    await lastValueFrom(repo.checkout("topic"));
    await commitFile(repo, "b.txt", "b", "Topic");
    const topicHead = await lastValueFrom(repo.resolveRef("HEAD"));
    await lastValueFrom(repo.checkout("main"));
    await commitFile(repo, "c.txt", "c", "Main");
    const mainHead = await lastValueFrom(repo.resolveRef("HEAD"));

    const base = await lastValueFrom(findMergeBase$(repo, mainHead!, topicHead!));

    expect(base).toBe(root);
  });

  test("finds the ancestor in a linear history", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    const first = await lastValueFrom(repo.resolveRef("HEAD"));
    await commitFile(repo, "b.txt", "b", "Second");
    const second = await lastValueFrom(repo.resolveRef("HEAD"));

    const base = await lastValueFrom(findMergeBase$(repo, first!, second!));

    expect(base).toBe(first);
  });
});
