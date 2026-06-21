import { describe, expect, test } from "bun:test";
import { MemoryBackend } from "@slim-git/memory";
import { ObjectStore, Sha1Hash } from "./index.js";
import { CommitBuilder } from "./commit-builder.js";

const person = {
  name: "Alice",
  email: "alice@example.com",
  timestamp: new Date(0),
  timezoneOffsetMinutes: 0,
};

describe("CommitBuilder", () => {
  test("builds a root commit", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const tree = await store.write("tree", new TextEncoder().encode("tree content"));

    const oid = await new CommitBuilder()
      .tree(tree.oid)
      .author(person)
      .committer(person)
      .message("Initial commit")
      .build(store);

    const commit = await store.read(oid);
    expect(commit.type).toBe("commit");
    const text = new TextDecoder().decode(commit.content);
    expect(text).toContain("tree " + tree.oid);
    expect(text).toContain("Initial commit");
    expect(text).not.toContain("parent");
  });

  test("builds a commit with parents", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const tree = await store.write("tree", new TextEncoder().encode("tree content"));
    const parent = await new CommitBuilder()
      .tree(tree.oid)
      .author(person)
      .committer(person)
      .message("Parent")
      .build(store);

    const child = await new CommitBuilder()
      .tree(tree.oid)
      .parent(parent)
      .author(person)
      .committer(person)
      .message("Child")
      .build(store);

    const commit = await store.read(child);
    const text = new TextDecoder().decode(commit.content);
    expect(text).toContain(`parent ${parent}`);
  });
});
