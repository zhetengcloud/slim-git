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

describe("Repository branches", () => {
  test("createBranch writes a ref and listBranches returns it", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");

    const head = await lastValueFrom(repo.refs.read("HEAD"));
    await lastValueFrom(repo.createBranch("feature", { target: head! }));

    const branches = await lastValueFrom(repo.listBranches());
    expect(branches).toHaveLength(1);
    expect(branches[0]!.name).toBe("feature");
  });

  test("createBranch without target uses HEAD", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    const head = await lastValueFrom(repo.refs.read("HEAD"));

    await lastValueFrom(repo.createBranch("feature"));

    expect(await lastValueFrom(repo.refs.read("refs/heads/feature"))).toBe(head);
  });

  test("createBranch throws when branch exists", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    await lastValueFrom(repo.createBranch("feature"));

    await expect(lastValueFrom(repo.createBranch("feature"))).rejects.toThrow();
  });

  test("deleteBranch removes the ref", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    await lastValueFrom(repo.createBranch("feature"));

    await lastValueFrom(repo.deleteBranch("feature"));

    expect(await lastValueFrom(repo.refs.read("refs/heads/feature"))).toBeUndefined();
  });

  test("deleteBranch refuses to delete current branch", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    await lastValueFrom(repo.createBranch("main"));
    await lastValueFrom(repo.checkout("main"));

    await expect(lastValueFrom(repo.deleteBranch("main"))).rejects.toThrow();
  });

  test("getCurrentBranch returns symbolic branch name", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    await lastValueFrom(repo.createBranch("main"));
    await lastValueFrom(repo.checkout("main"));

    expect(await lastValueFrom(repo.getCurrentBranch())).toBe("main");
  });

  test("getCurrentBranch returns undefined when detached", async () => {
    const repo = await setupRepo({});
    const oid = await commitAndGetOid(repo, "a.txt", "a", "First");

    expect(await lastValueFrom(repo.getCurrentBranch())).toBeUndefined();
    await lastValueFrom(repo.checkout(oid));
    expect(await lastValueFrom(repo.getCurrentBranch())).toBeUndefined();
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
