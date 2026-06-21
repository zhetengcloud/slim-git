import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { MemoryBackend } from "@slim-git/memory";
import { ObjectStore, Sha1Hash, TreeBuilder } from "@slim-git/core";

describe("TreeBuilder", () => {
  test("builds a flat tree", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const blob = await lastValueFrom(store.write("blob", new TextEncoder().encode("hello\n")));
    const treeOid = await lastValueFrom(
      new TreeBuilder().insert("hello.txt", blob.oid, 0o100644).build(store),
    );

    const tree = await lastValueFrom(store.read(treeOid));
    expect(tree.type).toBe("tree");
  });

  test("builds a nested tree", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const blob = await lastValueFrom(store.write("blob", new TextEncoder().encode("content")));
    const treeOid = await lastValueFrom(
      new TreeBuilder()
        .insert("src/main.ts", blob.oid, 0o100644)
        .insert("README.md", blob.oid, 0o100644)
        .build(store),
    );

    const tree = await lastValueFrom(store.read(treeOid));
    const text = new TextDecoder().decode(tree.content);
    expect(text).toContain("src");
    expect(text).toContain("README.md");
  });

  test("produces stable oids for the same tree", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const blob = await lastValueFrom(store.write("blob", new TextEncoder().encode("x")));

    const first = await lastValueFrom(
      new TreeBuilder().insert("a.txt", blob.oid, 0o100644).build(store),
    );
    const second = await lastValueFrom(
      new TreeBuilder().insert("a.txt", blob.oid, 0o100644).build(store),
    );

    expect(first).toBe(second);
  });
});
