import { describe, expect, test } from "bun:test";
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

describe("Repository fast-forward merge", () => {
  test("merges when target is ahead of HEAD", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    await lastValueFrom(repo.createBranch("main"));
    await lastValueFrom(repo.checkout("main"));
    await lastValueFrom(repo.createBranch("topic"));
    await lastValueFrom(repo.checkout("topic"));
    await commitFile(repo, "b.txt", "b", "Second on topic");
    const topicHead = await lastValueFrom(repo.refs.read("refs/heads/topic"));
    await lastValueFrom(repo.checkout("main"));

    const result = await lastValueFrom(repo.fastForwardMerge("topic"));

    expect(result).toMatchObject({ merged: true, commitOid: topicHead });
    expect(await lastValueFrom(repo.workspace.exists("b.txt"))).toBe(true);
    expect(await lastValueFrom(repo.refs.read("refs/heads/main"))).toBe(topicHead);
  });

  test("does nothing when target equals HEAD", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    const head = await lastValueFrom(repo.refs.read("HEAD"));

    const result = await lastValueFrom(repo.fastForwardMerge("HEAD"));

    expect(result).toMatchObject({ merged: true, commitOid: head });
    expect(await lastValueFrom(repo.refs.read("HEAD"))).toBe(head);
  });

  test("rejects a non-fast-forward merge", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    await lastValueFrom(repo.createBranch("main"));
    await lastValueFrom(repo.checkout("main"));
    await lastValueFrom(repo.createBranch("topic"));
    await lastValueFrom(repo.checkout("topic"));
    await commitFile(repo, "b.txt", "b", "Topic commit");
    await lastValueFrom(repo.checkout("main"));
    await commitFile(repo, "c.txt", "c", "Main commit");

    await expect(lastValueFrom(repo.fastForwardMerge("topic"))).rejects.toThrow();
  });

  test("rejects a missing target", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");

    await expect(lastValueFrom(repo.fastForwardMerge("missing"))).rejects.toThrow();
  });

  test("updates a detached HEAD", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    const first = await lastValueFrom(repo.refs.read("HEAD"));
    await lastValueFrom(repo.createBranch("main"));
    await lastValueFrom(repo.checkout("main"));
    await commitFile(repo, "b.txt", "b", "Second");
    await lastValueFrom(repo.checkout(first!));

    const result = await lastValueFrom(repo.fastForwardMerge("main"));

    expect(await lastValueFrom(repo.refs.read("HEAD"))).not.toBe(first);
    expect(result.merged).toBe(true);
  });
});
