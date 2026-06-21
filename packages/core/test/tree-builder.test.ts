import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { MemoryBackend } from "@slim-git/memory";
import { ObjectStore, Sha1Hash, TreeBuilder } from "@slim-git/core";

const createStore = () => new ObjectStore(new MemoryBackend(), Sha1Hash);

const writeBlob = async (store: ObjectStore, content: string) =>
  await lastValueFrom(store.write("blob", new TextEncoder().encode(content)));

describe("TreeBuilder", () => {
  test("builds a flat tree", async () => {
    const store = createStore();
    const blob = await writeBlob(store, "hello\n");
    const treeOid = await lastValueFrom(
      new TreeBuilder().insert("hello.txt", blob.oid, 0o100644).build(store),
    );

    const tree = await lastValueFrom(store.read(treeOid));
    expect(tree.type).toBe("tree");
  });

  test("builds a nested tree", async () => {
    const store = createStore();
    const blob = await writeBlob(store, "content");
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
    const store = createStore();
    const blob = await writeBlob(store, "x");

    const first = await lastValueFrom(
      new TreeBuilder().insert("a.txt", blob.oid, 0o100644).build(store),
    );
    const second = await lastValueFrom(
      new TreeBuilder().insert("a.txt", blob.oid, 0o100644).build(store),
    );

    expect(first).toBe(second);
  });

  test("produces the same oid regardless of insert order", async () => {
    const store = createStore();
    const a = await writeBlob(store, "a");
    const b = await writeBlob(store, "b");

    const first = await lastValueFrom(
      new TreeBuilder()
        .insert("src/index.ts", a.oid, 0o100644)
        .insert("README.md", b.oid, 0o100644)
        .build(store),
    );
    const second = await lastValueFrom(
      new TreeBuilder()
        .insert("README.md", b.oid, 0o100644)
        .insert("src/index.ts", a.oid, 0o100644)
        .build(store),
    );

    expect(first).toBe(second);
  });

  test("builds an empty tree", async () => {
    const store = createStore();
    const treeOid = await lastValueFrom(new TreeBuilder().build(store));

    const tree = await lastValueFrom(store.read(treeOid));
    expect(tree.type).toBe("tree");
    expect(tree.content).toHaveLength(0);
  });

  test("builds a deeply nested tree", async () => {
    const store = createStore();
    const blob = await writeBlob(store, "deep");
    const treeOid = await lastValueFrom(
      new TreeBuilder().insert("a/b/c/d/file.txt", blob.oid, 0o100644).build(store),
    );

    const tree = await lastValueFrom(store.read(treeOid));
    expect(tree.type).toBe("tree");
    const text = new TextDecoder().decode(tree.content);
    expect(text).toContain("a");
  });

  test("builds a tree with multiple files in the same directory", async () => {
    const store = createStore();
    const a = await writeBlob(store, "a");
    const b = await writeBlob(store, "b");
    const c = await writeBlob(store, "c");

    const treeOid = await lastValueFrom(
      new TreeBuilder()
        .insert("src/a.ts", a.oid, 0o100644)
        .insert("src/b.ts", b.oid, 0o100644)
        .insert("src/c.ts", c.oid, 0o100644)
        .build(store),
    );

    const tree = await lastValueFrom(store.read(treeOid));
    const text = new TextDecoder().decode(tree.content);
    expect(text).toContain("src");
  });

  test("builds a tree with multiple sibling directories", async () => {
    const store = createStore();
    const blob = await writeBlob(store, "x");

    const treeOid = await lastValueFrom(
      new TreeBuilder()
        .insert("src/index.ts", blob.oid, 0o100644)
        .insert("test/index.test.ts", blob.oid, 0o100644)
        .insert("docs/readme.md", blob.oid, 0o100644)
        .build(store),
    );

    const tree = await lastValueFrom(store.read(treeOid));
    const text = new TextDecoder().decode(tree.content);
    expect(text).toContain("src");
    expect(text).toContain("test");
    expect(text).toContain("docs");
  });

  test("allows the same filename in different directories", async () => {
    const store = createStore();
    const a = await writeBlob(store, "a");
    const b = await writeBlob(store, "b");

    const treeOid = await lastValueFrom(
      new TreeBuilder()
        .insert("src/index.ts", a.oid, 0o100644)
        .insert("test/index.ts", b.oid, 0o100644)
        .build(store),
    );

    const tree = await lastValueFrom(store.read(treeOid));
    expect(tree.type).toBe("tree");
  });

  test("builds a tree with mixed root files and directories", async () => {
    const store = createStore();
    const rootBlob = await writeBlob(store, "root");
    const nestedBlob = await writeBlob(store, "nested");

    const treeOid = await lastValueFrom(
      new TreeBuilder()
        .insert("README.md", rootBlob.oid, 0o100644)
        .insert("src/main.ts", nestedBlob.oid, 0o100644)
        .insert("package.json", rootBlob.oid, 0o100644)
        .build(store),
    );

    const tree = await lastValueFrom(store.read(treeOid));
    const text = new TextDecoder().decode(tree.content);
    expect(text).toContain("README.md");
    expect(text).toContain("package.json");
    expect(text).toContain("src");
  });
});
