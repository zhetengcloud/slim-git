import { describe, expect, test } from "bun:test";
import { createMemoryRepository } from "@slim-git/memory";
import type { Repository } from "./repository.js";

const person = {
  name: "Dev",
  email: "dev@example.com",
  timestamp: new Date(0),
  timezoneOffsetMinutes: 0,
};

const setupRepo = async (files: Record<string, string>): Promise<Repository> => {
  const repo = await createMemoryRepository();
  await Promise.all(
    Object.entries(files).map(([path, content]) =>
      repo.workspace.writeFile(path, new TextEncoder().encode(content)),
    ),
  );
  return repo;
};

describe("Repository staging and commit", () => {
  test("add stages a file", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });

    await repo.add(["a.txt"]);
    const status = await repo.status();

    expect(status.staged).toContain("a.txt");
    expect(status.untracked).toEqual([]);
  });

  test("commit creates a commit and updates HEAD", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await repo.add(["a.txt"]);

    const oid = await repo.commit({ message: "First", author: person });

    expect(await repo.refs.read("HEAD")).toBe(oid);
    const commit = await repo.objectStore.read(oid);
    expect(commit.type).toBe("commit");
  });

  test("commit clears the index", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await repo.add(["a.txt"]);
    await repo.commit({ message: "First", author: person });

    const status = await repo.status();
    expect(status.staged).toEqual([]);
  });

  test("amend rewrites HEAD keeping the tree", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await repo.add(["a.txt"]);
    const first = await repo.commit({ message: "First", author: person });

    const amended = await repo.amend({ message: "Amended", author: person });

    expect(await repo.refs.read("HEAD")).toBe(amended);
    expect(amended).not.toBe(first);
  });

  test("status reports untracked files", async () => {
    const repo = await setupRepo({ "new.txt": "new" });

    const status = await repo.status();

    expect(status.untracked).toContain("new.txt");
  });

  test("status reports modified files", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await repo.add(["a.txt"]);
    await repo.workspace.writeFile("a.txt", new TextEncoder().encode("changed"));

    const status = await repo.status();

    expect(status.modified).toContain("a.txt");
  });

  test("remove deletes from workspace and index", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await repo.add(["a.txt"]);
    await repo.remove(["a.txt"]);

    expect(await repo.workspace.exists("a.txt")).toBe(false);
    const status = await repo.status();
    expect(status.staged).toEqual([]);
  });

  test("restore writes indexed content to workspace", async () => {
    const repo = await setupRepo({ "a.txt": "hello" });
    await repo.add(["a.txt"]);
    await repo.workspace.writeFile("a.txt", new TextEncoder().encode("changed"));

    await repo.restore(["a.txt"]);

    const content = new TextDecoder().decode(await repo.workspace.readFile("a.txt"));
    expect(content).toBe("hello");
  });
});
