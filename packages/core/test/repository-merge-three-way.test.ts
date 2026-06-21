import { describe, expect, test } from "bun:test";
import { defaultIfEmpty, forkJoin, lastValueFrom, take } from "rxjs";
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

const readText = async (repo: Repository, path: string): Promise<string> =>
  new TextDecoder().decode(await lastValueFrom(repo.workspace.readFile(path)));

describe("Repository three-way merge", () => {
  test("creates a merge commit for non-conflicting changes", async () => {
    const repo = await setupRepo({ "a.txt": "base" });
    await lastValueFrom(repo.add(["a.txt"]));
    await lastValueFrom(repo.commit({ message: "Base", author: person }));
    await lastValueFrom(repo.createBranch("main"));
    await lastValueFrom(repo.checkout("main"));
    await lastValueFrom(repo.createBranch("topic"));
    await lastValueFrom(repo.checkout("topic"));
    await commitFile(repo, "a.txt", "topic", "Topic change");
    const topicHead = await lastValueFrom(repo.resolveRef("HEAD"));
    await lastValueFrom(repo.checkout("main"));
    await commitFile(repo, "b.txt", "main", "Main addition");
    const mainHead = await lastValueFrom(repo.resolveRef("HEAD"));

    const result = await lastValueFrom(repo.merge("topic", { author: person }));

    expect(result).toMatchObject({ merged: true });
    if (result.merged) {
      const mergeCommit = await lastValueFrom(repo.log({ ref: result.commitOid }).pipe(take(1)));
      expect(mergeCommit.parents).toContain(mainHead!);
      expect(mergeCommit.parents).toContain(topicHead!);
    }
    expect(await readText(repo, "a.txt")).toBe("topic");
    expect(await readText(repo, "b.txt")).toBe("main");
  });

  test("reports conflicts when both sides modify the same file", async () => {
    const repo = await setupRepo({ "a.txt": "base" });
    await lastValueFrom(repo.add(["a.txt"]));
    await lastValueFrom(repo.commit({ message: "Base", author: person }));
    await lastValueFrom(repo.createBranch("main"));
    await lastValueFrom(repo.checkout("main"));
    await lastValueFrom(repo.createBranch("topic"));
    await lastValueFrom(repo.checkout("topic"));
    await commitFile(repo, "a.txt", "topic", "Topic change");
    await lastValueFrom(repo.checkout("main"));
    await commitFile(repo, "a.txt", "main", "Main change");
    const mainHead = await lastValueFrom(repo.resolveRef("HEAD"));

    const result = await lastValueFrom(repo.merge("topic", { author: person }));

    expect(result).toMatchObject({ merged: false });
    if (!result.merged) {
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.path).toBe("a.txt");
    }
    const text = await readText(repo, "a.txt");
    expect(text).toContain("<<<<<<< HEAD");
    expect(text).toContain("=======");
    expect(text).toContain(">>>>>>> topic");
    expect(await lastValueFrom(repo.resolveRef("HEAD"))).toBe(mainHead);
  });

  test("fast-forwards when possible via merge", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "Root");
    await lastValueFrom(repo.createBranch("main"));
    await lastValueFrom(repo.checkout("main"));
    await lastValueFrom(repo.createBranch("topic"));
    await lastValueFrom(repo.checkout("topic"));
    await commitFile(repo, "b.txt", "b", "Topic");
    const topicHead = await lastValueFrom(repo.resolveRef("HEAD"));
    await lastValueFrom(repo.checkout("main"));

    const result = await lastValueFrom(repo.merge("topic", { author: person }));

    expect(result).toMatchObject({ merged: true, commitOid: topicHead });
    expect(await lastValueFrom(repo.resolveRef("HEAD"))).toBe(topicHead);
  });
});
