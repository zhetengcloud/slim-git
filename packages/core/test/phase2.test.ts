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

describe("Repository tags", () => {
  test("createTag writes a ref and listTags returns it", async () => {
    const repo = await setupRepo({});
    const oid = await commitAndGetOid(repo, "a.txt", "a", "First");

    await lastValueFrom(repo.createTag("v1.0.0", { target: oid }));

    const tags = await lastValueFrom(repo.listTags());
    expect(tags).toHaveLength(1);
    expect(tags[0]!.name).toBe("v1.0.0");
    expect(tags[0]!.target).toBe(oid);
  });

  test("createTag defaults to HEAD", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    const head = await lastValueFrom(repo.refs.read("HEAD"));

    await lastValueFrom(repo.createTag("v1.0.0"));

    expect(await lastValueFrom(repo.refs.read("refs/tags/v1.0.0"))).toBe(head);
  });

  test("createTag throws when tag exists", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    await lastValueFrom(repo.createTag("v1.0.0"));

    await expect(lastValueFrom(repo.createTag("v1.0.0"))).rejects.toThrow();
  });

  test("deleteTag removes the ref", async () => {
    const repo = await setupRepo({});
    await commitFile(repo, "a.txt", "a", "First");
    await lastValueFrom(repo.createTag("v1.0.0"));

    await lastValueFrom(repo.deleteTag("v1.0.0"));

    expect(await lastValueFrom(repo.refs.read("refs/tags/v1.0.0"))).toBeUndefined();
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
