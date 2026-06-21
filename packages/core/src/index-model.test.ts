import type { IndexEntry, Oid } from "@slim-git/types";
import { describe, expect, test } from "bun:test";
import { Index } from "./index-model.js";

const entry = (path: string, oid: string): IndexEntry => ({
  path,
  oid: oid as unknown as Oid,
  mode: 0o100644,
  stage: 0,
  fileSize: 0,
  ctimeSeconds: 0,
  ctimeNanos: 0,
  mtimeSeconds: 0,
  mtimeNanos: 0,
  dev: 0,
  ino: 0,
  uid: 0,
  gid: 0,
  assumeValid: false,
  extended: false,
  skipWorktree: false,
  intentToAdd: false,
});

describe("Index", () => {
  test("starts empty", () => {
    const index = Index.empty();
    expect(index.paths).toEqual([]);
    expect(index.has("a")).toBe(false);
  });

  test("add returns a new index with the entry", () => {
    const index = Index.empty().add(entry("a.txt", "oid1"));

    expect(index.has("a.txt")).toBe(true);
    expect(index.get("a.txt")?.oid).toBe("oid1" as Oid);
  });

  test("add replaces an existing entry", () => {
    const index = Index.empty().add(entry("a.txt", "oid1")).add(entry("a.txt", "oid2"));

    expect(index.get("a.txt")?.oid).toBe("oid2" as Oid);
  });

  test("remove deletes an entry", () => {
    const index = Index.empty().add(entry("a.txt", "oid1")).remove("a.txt");

    expect(index.has("a.txt")).toBe(false);
  });

  test("removeMany deletes multiple entries", () => {
    const index = Index.empty()
      .add(entry("a.txt", "oid1"))
      .add(entry("b.txt", "oid2"))
      .add(entry("c.txt", "oid3"))
      .removeMany(["a.txt", "c.txt"]);

    expect(index.paths).toEqual(["b.txt"]);
  });

  test("toArray returns entries sorted by path", () => {
    const index = Index.empty().add(entry("b.txt", "oid2")).add(entry("a.txt", "oid1"));

    expect(index.toArray().map((e) => e.path)).toEqual(["a.txt", "b.txt"]);
  });
});
