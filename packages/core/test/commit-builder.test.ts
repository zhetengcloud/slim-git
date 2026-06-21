import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { MemoryBackend } from "@slim-git/memory";
import { CommitBuilder, ObjectStore, Sha1Hash } from "@slim-git/core";

const person = {
  name: "Alice",
  email: "alice@example.com",
  timestamp: new Date(0),
  timezoneOffsetMinutes: 0,
};

describe("CommitBuilder", () => {
  test("builds a root commit", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const tree = await lastValueFrom(store.write("tree", new TextEncoder().encode("tree content")));

    const oid = await lastValueFrom(
      new CommitBuilder()
        .tree(tree.oid)
        .author(person)
        .committer(person)
        .message("Initial commit")
        .build(store),
    );

    const commit = await lastValueFrom(store.read(oid));
    expect(commit.type).toBe("commit");
    const text = new TextDecoder().decode(commit.content);
    expect(text).toContain("tree " + tree.oid);
    expect(text).toContain("Initial commit");
    expect(text).not.toContain("parent");
  });

  test("builds a commit with parents", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const tree = await lastValueFrom(store.write("tree", new TextEncoder().encode("tree content")));
    const parent = await lastValueFrom(
      new CommitBuilder()
        .tree(tree.oid)
        .author(person)
        .committer(person)
        .message("Parent")
        .build(store),
    );

    const child = await lastValueFrom(
      new CommitBuilder()
        .tree(tree.oid)
        .parent(parent)
        .author(person)
        .committer(person)
        .message("Child")
        .build(store),
    );

    const commit = await lastValueFrom(store.read(child));
    const text = new TextDecoder().decode(commit.content);
    expect(text).toContain(`parent ${parent}`);
  });
});
