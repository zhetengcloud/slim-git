import { describe, expect, test } from "bun:test";
import { createHunks, myersDiff, unifiedDiff } from "@slim-git/core";

const encode = (text: string) => new TextEncoder().encode(text);

describe("myersDiff", () => {
  test("returns an empty edit script for two empty inputs", () => {
    expect(myersDiff([], [])).toEqual([]);
  });

  test("marks every new line as an insert when old is empty", () => {
    expect(myersDiff([], ["a\n", "b\n"])).toEqual([
      { type: "insert", oldIndex: -1, newIndex: 0 },
      { type: "insert", oldIndex: -1, newIndex: 1 },
    ]);
  });

  test("marks every old line as a delete when new is empty", () => {
    expect(myersDiff(["a\n", "b\n"], [])).toEqual([
      { type: "delete", oldIndex: 0, newIndex: -1 },
      { type: "delete", oldIndex: 1, newIndex: -1 },
    ]);
  });

  test("returns equal edits for identical inputs", () => {
    expect(myersDiff(["a\n", "b\n"], ["a\n", "b\n"])).toEqual([
      { type: "equal", oldIndex: 0, newIndex: 0 },
      { type: "equal", oldIndex: 1, newIndex: 1 },
    ]);
  });

  test("detects a single inserted line", () => {
    expect(myersDiff(["a\n"], ["a\n", "b\n"])).toEqual([
      { type: "equal", oldIndex: 0, newIndex: 0 },
      { type: "insert", oldIndex: -1, newIndex: 1 },
    ]);
  });

  test("detects a single deleted line", () => {
    expect(myersDiff(["a\n", "b\n"], ["a\n"])).toEqual([
      { type: "equal", oldIndex: 0, newIndex: 0 },
      { type: "delete", oldIndex: 1, newIndex: -1 },
    ]);
  });

  test("detects a single replaced line", () => {
    expect(myersDiff(["a\n"], ["b\n"])).toEqual([
      { type: "delete", oldIndex: 0, newIndex: -1 },
      { type: "insert", oldIndex: -1, newIndex: 0 },
    ]);
  });

  test("detects multiple separate changes", () => {
    expect(myersDiff(["a\n", "b\n", "c\n"], ["a\n", "x\n", "c\n"])).toEqual([
      { type: "equal", oldIndex: 0, newIndex: 0 },
      { type: "delete", oldIndex: 1, newIndex: -1 },
      { type: "insert", oldIndex: -1, newIndex: 1 },
      { type: "equal", oldIndex: 2, newIndex: 2 },
    ]);
  });
});

describe("createHunks", () => {
  test("returns an empty array when there are no edits", () => {
    expect(createHunks([], [], [], 3)).toEqual([]);
  });

  test("creates one hunk for a single change with context", () => {
    const oldLines = ["1\n", "2\n", "3\n", "4\n", "5\n"];
    const newLines = ["1\n", "2\n", "three\n", "4\n", "5\n"];
    const edits = myersDiff(oldLines, newLines);
    const hunks = createHunks(edits, oldLines, newLines, 1);

    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({
      oldStart: 2,
      newStart: 2,
      oldLines: 3,
      newLines: 3,
    });
    expect(hunks[0]!.lines).toEqual([
      { type: "context", text: "2\n" },
      { type: "removed", text: "3\n" },
      { type: "added", text: "three\n" },
      { type: "context", text: "4\n" },
    ]);
  });

  test("merges adjacent changes into a single hunk", () => {
    const oldLines = ["1\n", "2\n", "3\n", "4\n", "5\n"];
    const newLines = ["1\n", "two\n", "three\n", "4\n", "5\n"];
    const edits = myersDiff(oldLines, newLines);
    const hunks = createHunks(edits, oldLines, newLines, 3);

    expect(hunks).toHaveLength(1);
  });

  test("respects the requested number of context lines", () => {
    const oldLines = ["1\n", "2\n", "3\n", "4\n", "5\n"];
    const newLines = ["1\n", "2\n", "three\n", "4\n", "5\n"];
    const edits = myersDiff(oldLines, newLines);
    const hunks = createHunks(edits, oldLines, newLines, 0);

    expect(hunks[0]!.lines).toEqual([
      { type: "removed", text: "3\n" },
      { type: "added", text: "three\n" },
    ]);
  });
});

describe("unifiedDiff", () => {
  test("returns an empty array when both inputs are empty", () => {
    expect(unifiedDiff(new Uint8Array(0), new Uint8Array(0))).toEqual([]);
  });

  test("reports an added line", () => {
    const hunks = unifiedDiff(encode("a\n"), encode("a\nb\n"));

    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toEqual([
      { type: "context", text: "a\n" },
      { type: "added", text: "b\n" },
    ]);
  });

  test("reports a removed line", () => {
    const hunks = unifiedDiff(encode("a\nb\n"), encode("a\n"));

    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toEqual([
      { type: "context", text: "a\n" },
      { type: "removed", text: "b\n" },
    ]);
  });

  test("reports a changed line", () => {
    const hunks = unifiedDiff(encode("a\n"), encode("b\n"));

    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toEqual([
      { type: "removed", text: "a\n" },
      { type: "added", text: "b\n" },
    ]);
  });

  test("includes context lines around changes", () => {
    const oldText = ["1\n", "2\n", "3\n", "4\n", "5\n"].join("");
    const newText = ["1\n", "2\n", "three\n", "4\n", "5\n"].join("");
    const hunks = unifiedDiff(encode(oldText), encode(newText), 1);

    expect(hunks[0]!.lines).toEqual([
      { type: "context", text: "2\n" },
      { type: "removed", text: "3\n" },
      { type: "added", text: "three\n" },
      { type: "context", text: "4\n" },
    ]);
  });
});
