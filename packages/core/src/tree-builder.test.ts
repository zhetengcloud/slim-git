import { describe, expect, test } from "bun:test";
import { MemoryBackend } from "@slim-git/memory";
import { ObjectStore, Sha1Hash } from "./index.js";
import { TreeBuilder } from "./tree-builder.js";

describe("TreeBuilder", () => {
  test("builds a flat tree", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const blob = await store.write("blob", new TextEncoder().encode("hello\n"));
    const treeOid = await new TreeBuilder().insert("hello.txt", blob.oid, 0o100644).build(store);

    const tree = await store.read(treeOid);
    expect(tree.type).toBe("tree");
  });

  test("builds a nested tree", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const blob = await store.write("blob", new TextEncoder().encode("content"));
    const treeOid = await new TreeBuilder()
      .insert("src/main.ts", blob.oid, 0o100644)
      .insert("README.md", blob.oid, 0o100644)
      .build(store);

    const tree = await store.read(treeOid);
    const text = new TextDecoder().decode(tree.content);
    expect(text).toContain("src");
    expect(text).toContain("README.md");
  });

  test("produces stable oids for the same tree", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const blob = await store.write("blob", new TextEncoder().encode("x"));

    const first = await new TreeBuilder().insert("a.txt", blob.oid, 0o100644).build(store);
    const second = await new TreeBuilder().insert("a.txt", blob.oid, 0o100644).build(store);

    expect(first).toBe(second);
  });
});
