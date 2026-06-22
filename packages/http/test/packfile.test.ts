import { describe, expect, test } from "bun:test";
import { Sha1Hash } from "@slim-git/core";
import type { GitObject } from "@slim-git/types";
import { applyDelta, buildPackfile, parsePackfile$ } from "@slim-git/http";
import { lastValueFrom } from "rxjs";

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
    const parsed = await lastValueFrom(parsePackfile$(packfile, hash));

    expect(parsed).toHaveLength(2);
    for (const object of objects) {
      const match = parsed.find(
        (parsedObject) => parsedObject.oid === object.oid,
      );
      expect(match).toBeDefined();
      expect(match?.type).toBe(object.type);
      expect(match?.content).toEqual(object.content);
    }
  });

  test("produces deterministic bytes for the same input", () => {
    const objects = [blob("a"), blob("b"), commit("c")];
    expect(buildPackfile(objects)).toEqual(buildPackfile(objects));
  });

  test("builds an empty packfile", () => {
    const packfile = buildPackfile([]);

    expect(packfile.length).toBeGreaterThan(0);
    expect(packfile.slice(0, 4)).toEqual(new TextEncoder().encode("PACK"));
    expect(packfile[7]).toBe(2); // version high byte
    expect(packfile.slice(8, 12)).toEqual(new Uint8Array([0, 0, 0, 0])); // object count
  });

  test("parsePackfile$ emits empty array for empty packfile", async () => {
    const packfile = buildPackfile([]);
    const parsed = await lastValueFrom(parsePackfile$(packfile, hash));

    expect(parsed).toHaveLength(0);
  });

  test("parsePackfile$ errors on invalid magic", async () => {
    const packfile = buildPackfile([blob("x")]);
    packfile[0] = 0x00;

    expect(lastValueFrom(parsePackfile$(packfile, hash))).rejects.toThrow(
      "Invalid packfile magic",
    );
  });

  test("parsePackfile$ errors on unsupported version", async () => {
    const packfile = buildPackfile([blob("x")]);
    packfile[7] = 0x63; // set version to 99

    expect(lastValueFrom(parsePackfile$(packfile, hash))).rejects.toThrow(
      "Unsupported packfile version",
    );
  });

  test("parsePackfile$ errors on checksum mismatch", async () => {
    const packfile = buildPackfile([blob("x")]);
    packfile[packfile.length - 1]! ^= 0xff;

    expect(lastValueFrom(parsePackfile$(packfile, hash))).rejects.toThrow(
      "Packfile checksum mismatch",
    );
  });

  test("parsePackfile$ errors on truncated packfile", async () => {
    const packfile = buildPackfile([blob("x")]).slice(0, 10);

    expect(lastValueFrom(parsePackfile$(packfile, hash))).rejects.toThrow(
      "Packfile too small",
    );
  });
});

describe("applyDelta", () => {
  test("copies bytes from the base", () => {
    const base = new TextEncoder().encode("commit 5\0hello");
    const delta = new Uint8Array([base.length, base.length, 0x90, base.length]);

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

  test("inserts literal bytes only", () => {
    const base = new TextEncoder().encode("blob 5\0hello");
    const literal = new TextEncoder().encode("world");
    const expected = literal;
    const delta = new Uint8Array([
      base.length,
      expected.length,
      literal.length,
      ...literal,
    ]);

    const result = applyDelta(delta, base);
    expect(result).toEqual(expected);
  });

  test("handles zero copy size as the maximum copy size", () => {
    const base = new TextEncoder().encode("blob 5\0hello");
    const expected = base;
    // Copy with size byte 0, which encodes the maximum copy size (64 KiB).
    // The actual bytes copied are clamped to the base length.
    const delta = new Uint8Array([base.length, base.length, 0b10010000, 0]);

    const result = applyDelta(delta, base);
    expect(result).toEqual(expected);
  });

  test("applies multiple copy and insert instructions", () => {
    const base = new TextEncoder().encode("hello world");
    const expected = new TextEncoder().encode("he-llo-!");
    // "he" (copy offset 0, size 2), "-" (insert 1), "llo" (copy offset 2, size 3), "-" (insert 1), "!" (insert 1)
    const delta = new Uint8Array([
      base.length,
      expected.length,
      0b10010001, // copy, size byte present, offset byte 1 present, size = 2, offset = 0
      0,
      2,
      0x01,
      0x2d, // '-'
      0b10010001, // copy, size byte present, offset byte 1 present, size = 3, offset = 2
      2,
      3,
      0x01,
      0x2d, // '-'
      0x01,
      0x21, // '!'
    ]);

    const result = applyDelta(delta, base);
    expect(result).toEqual(expected);
  });

  test("throws when base length does not match", () => {
    const base = new TextEncoder().encode("blob 5\0hello");
    const delta = new Uint8Array([0, 0, 0x90, base.length]);

    expect(() => applyDelta(delta, base)).toThrow("Delta base length mismatch");
  });

  test("throws when result length does not match", () => {
    const base = new TextEncoder().encode("blob 5\0hello");
    // Header claims result length 1 but no instructions write anything.
    const delta = new Uint8Array([base.length, 1]);

    expect(() => applyDelta(delta, base)).toThrow(
      "Delta result length mismatch",
    );
  });
});
