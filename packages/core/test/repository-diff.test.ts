import { createMemoryRepository } from "@slim-git/memory";
import type { Repository } from "@slim-git/core";
import { lastValueFrom } from "rxjs";
import { describe, expect, test } from "bun:test";

const person = {
  name: "Dev",
  email: "dev@example.com",
  timestamp: new Date(),
  timezoneOffsetMinutes: 0,
};

const writeFile = async (repo: Repository, path: string, content: string) => {
  await lastValueFrom(repo.workspace.writeFile(path, new TextEncoder().encode(content)));
};

const commit = async (repo: Repository, message: string) => {
  return await lastValueFrom(
    repo.commit({
      message,
      author: person,
    }),
  );
};

describe("Repository diff", () => {
  test("diffWorktreeIndex is empty when workspace matches index", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await writeFile(repo, "a.txt", "a\n");
    await lastValueFrom(repo.add(["a.txt"]));

    const diff = await lastValueFrom(repo.diffWorktreeIndex());

    expect(diff.files).toHaveLength(0);
  });

  test("diffWorktreeIndex reports a modified file", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await writeFile(repo, "a.txt", "a\n");
    await lastValueFrom(repo.add(["a.txt"]));
    await writeFile(repo, "a.txt", "b\n");

    const diff = await lastValueFrom(repo.diffWorktreeIndex());

    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({
      path: "a.txt",
      status: "modified",
    });
    expect(diff.files[0]!.hunks).toHaveLength(1);
    expect(diff.files[0]!.hunks[0]!.lines).toEqual([
      { type: "removed", text: "a\n" },
      { type: "added", text: "b\n" },
    ]);
  });

  test("diffWorktreeIndex reports an added file", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await writeFile(repo, "a.txt", "a\n");

    const diff = await lastValueFrom(repo.diffWorktreeIndex());

    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({
      path: "a.txt",
      status: "added",
    });
  });

  test("diffWorktreeIndex reports a deleted file", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await writeFile(repo, "a.txt", "a\n");
    await lastValueFrom(repo.add(["a.txt"]));
    await lastValueFrom(repo.workspace.removeFile("a.txt"));

    const diff = await lastValueFrom(repo.diffWorktreeIndex());

    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]!).toMatchObject({
      path: "a.txt",
      status: "deleted",
    });
  });

  test("diffIndexHead reports staged changes", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await writeFile(repo, "a.txt", "a\n");
    await lastValueFrom(repo.add(["a.txt"]));
    await commit(repo, "first");
    await writeFile(repo, "a.txt", "b\n");
    await lastValueFrom(repo.add(["a.txt"]));

    const diff = await lastValueFrom(repo.diffIndexHead());

    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({
      path: "a.txt",
      status: "modified",
    });
  });

  test("diffHeadRef reports changes between HEAD and a branch", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await writeFile(repo, "a.txt", "a\n");
    await lastValueFrom(repo.add(["a.txt"]));
    const first = await commit(repo, "first");
    await writeFile(repo, "a.txt", "b\n");
    await lastValueFrom(repo.add(["a.txt"]));
    await commit(repo, "second");
    await lastValueFrom(repo.createBranch("topic", { target: first }));

    const diff = await lastValueFrom(repo.diffHeadRef("topic"));

    expect(diff.files).toHaveLength(1);
    expect(diff.files[0]).toMatchObject({
      path: "a.txt",
      status: "modified",
    });
  });

  test("diff includes context lines around changes", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    const lines = ["1\n", "2\n", "3\n", "4\n", "5\n", "6\n", "7\n", "8\n"].join("");
    await writeFile(repo, "a.txt", lines);
    await lastValueFrom(repo.add(["a.txt"]));
    const updated = lines.replace("5\n", "five\n");
    await writeFile(repo, "a.txt", updated);

    const diff = await lastValueFrom(repo.diffWorktreeIndex());

    expect(diff.files[0]!.hunks[0]!.lines).toEqual([
      { type: "context", text: "2\n" },
      { type: "context", text: "3\n" },
      { type: "context", text: "4\n" },
      { type: "removed", text: "5\n" },
      { type: "added", text: "five\n" },
      { type: "context", text: "6\n" },
      { type: "context", text: "7\n" },
      { type: "context", text: "8\n" },
    ]);
  });
});
