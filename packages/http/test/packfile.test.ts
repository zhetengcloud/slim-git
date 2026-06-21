import { describe, expect, test } from "bun:test";
import { Sha1Hash } from "@slim-git/core";
import type { GitObject } from "@slim-git/types";
import { applyDelta, buildPackfile, parsePackfile } from "@slim-git/http";

const hash = Sha1Hash;

const blob = (content: string): GitObject =>
  hash.hashObject("blob", new TextEncoder().encode(content));

const commit = (message: string): GitObject => {
  const lines = [
    `tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904`,
    `author Dev <dev@example.com> 0 +0000`,
    `committer Dev <dev@example.com> 0 +0000`,
    "",
    message,
  ];
  return hash.hashObject("commit", new TextEncoder().encode(lines.join("\n")));
};

describe("buildPackfile / parsePackfile", () => {
  test("round-trips commit and blob objects", async () => {
    const objects = [commit("initial"), blob("hello")];
    const packfile = buildPackfile(objects);
    const parsed = await parsePackfile(packfile, hash);

    expect(parsed).toHaveLength(2);
    for (const object of objects) {
      const match = parsed.find((parsedObject) => parsedObject.oid === object.oid);
      expect(match).toBeDefined();
      expect(match?.type).toBe(object.type);
      expect(match?.content).toEqual(object.content);
    }
  });

  test("produces deterministic bytes for the same input", () => {
    const objects = [blob("a"), blob("b"), commit("c")];
    expect(buildPackfile(objects)).toEqual(buildPackfile(objects));
  });
});

describe("applyDelta", () => {
  test("copies bytes from the base", () => {
    const base = new TextEncoder().encode("commit 5\0hello");
    const delta = new Uint8Array([
      base.length,
      base.length,
      0x90,
      base.length,
    ]);

    const result = applyDelta(delta, base);
    expect(result).toEqual(base);
  });

  test("copies base bytes and inserts new literal bytes", () => {
    const base = new TextEncoder().encode("commit 5\0hello");
    const expected = new TextEncoder().encode("commit 5\0hello!");
    const delta = new Uint8Array([
      base.length,
      expected.length,
      0x90,
      base.length,
      0x01,
      0x21, // '!'
    ]);

    const result = applyDelta(delta, base);
    expect(result).toEqual(expected);
  });
});
