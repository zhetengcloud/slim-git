import { describe, expect, test } from "bun:test";
import { isIgnored, parseGitignore } from "@slim-git/core";

describe("parseGitignore", () => {
  test("ignores blank lines and comments", () => {
    const patterns = parseGitignore("\n# comment\n*.log\n");
    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      pattern: "*.log",
      negated: false,
      directoryOnly: false,
      anchored: false,
    });
  });

  test("detects negated rules", () => {
    const patterns = parseGitignore("*.log\n!important.log");
    expect(patterns[1]).toMatchObject({ pattern: "important.log", negated: true });
  });

  test("detects directory-only rules", () => {
    const patterns = parseGitignore("node_modules/");
    expect(patterns[0]).toMatchObject({
      pattern: "node_modules",
      directoryOnly: true,
      anchored: false,
    });
  });

  test("detects anchored rules", () => {
    const patterns = parseGitignore("/build\nfoo/bar");
    expect(patterns[0]).toMatchObject({ pattern: "build", anchored: true });
    expect(patterns[1]).toMatchObject({ pattern: "foo/bar", anchored: true });
  });
});

describe("isIgnored", () => {
  test("matches glob patterns against file names", () => {
    const patterns = parseGitignore("*.log");
    expect(isIgnored("debug.log", patterns)).toBe(true);
    expect(isIgnored("dir/debug.log", patterns)).toBe(true);
    expect(isIgnored("debug.txt", patterns)).toBe(false);
  });

  test("honours anchored rules", () => {
    const patterns = parseGitignore("/build");
    expect(isIgnored("build", patterns)).toBe(true);
    expect(isIgnored("src/build", patterns)).toBe(false);
  });

  test("matches directory rules", () => {
    const patterns = parseGitignore("node_modules/");
    expect(isIgnored("node_modules", patterns)).toBe(true);
    expect(isIgnored("node_modules/foo/bar.js", patterns)).toBe(true);
    expect(isIgnored("src/node_modules", patterns)).toBe(true);
  });

  test("supports negation", () => {
    const patterns = parseGitignore("*.log\n!important.log");
    expect(isIgnored("a.log", patterns)).toBe(true);
    expect(isIgnored("important.log", patterns)).toBe(false);
  });
});
