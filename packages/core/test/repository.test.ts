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

describe("Repository staging and commit", () => {
  test("add stages a file", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });

    await lastValueFrom(repo.add(["a.txt"]));
    const status = await lastValueFrom(repo.status());

    expect(status.staged).toContain("a.txt");
    expect(status.untracked).toEqual([]);
  });

  test("commit creates a commit and updates HEAD", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await lastValueFrom(repo.add(["a.txt"]));

    const oid = await lastValueFrom(repo.commit({ message: "First", author: person }));

    expect(await lastValueFrom(repo.refs.read("HEAD"))).toBe(oid);
    const commit = await lastValueFrom(repo.objectStore.read(oid));
    expect(commit.type).toBe("commit");
  });

  test("commit clears the index", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await lastValueFrom(repo.add(["a.txt"]));
    await lastValueFrom(repo.commit({ message: "First", author: person }));

    const status = await lastValueFrom(repo.status());
    expect(status.staged).toEqual([]);
  });

  test("amend rewrites HEAD keeping the tree", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await lastValueFrom(repo.add(["a.txt"]));
    const first = await lastValueFrom(repo.commit({ message: "First", author: person }));

    const amended = await lastValueFrom(repo.amend({ message: "Amended", author: person }));

    expect(await lastValueFrom(repo.refs.read("HEAD"))).toBe(amended);
    expect(amended).not.toBe(first);
  });

  test("status reports untracked files", async () => {
    const repo = await setupRepo({ "new.txt": "new" });

    const status = await lastValueFrom(repo.status());

    expect(status.untracked).toContain("new.txt");
  });

  test("status reports modified files", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await lastValueFrom(repo.add(["a.txt"]));
    await lastValueFrom(repo.workspace.writeFile("a.txt", new TextEncoder().encode("changed")));

    const status = await lastValueFrom(repo.status());

    expect(status.modified).toContain("a.txt");
  });

  test("remove deletes from workspace and index", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await lastValueFrom(repo.add(["a.txt"]));
    await lastValueFrom(repo.remove(["a.txt"]));

    expect(await lastValueFrom(repo.workspace.exists("a.txt"))).toBe(false);
    const status = await lastValueFrom(repo.status());
    expect(status.staged).toEqual([]);
  });

  test("restore writes indexed content to workspace", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await lastValueFrom(repo.add(["a.txt"]));
    await lastValueFrom(repo.workspace.writeFile("a.txt", new TextEncoder().encode("changed")));

    await lastValueFrom(repo.restore(["a.txt"]));

    const content = new TextDecoder().decode(await lastValueFrom(repo.workspace.readFile("a.txt")));
    expect(content).toBe("hello");
  });
});
