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
