import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  groupEntries,
  isNodeNotFoundError,
  NodeConfig,
  parseConfig,
  quoteIfNeeded,
  readConfigEntries,
  replaceEntry,
  serializeConfig,
  stripComment,
  unquote,
  writeConfigEntries,
  type ConfigEntry,
} from "@slim-git/fs";

const withTempFile = async <T>(fn: (path: string) => Promise<T>): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), "slim-git-config-"));
  const path = join(dir, "config");
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe("NodeConfig", () => {
  test("reads flat section values", async () => {
    await withTempFile(async (path) => {
      await writeFile(path, "[core]\n\trepositoryformatversion = 0\n");
      const config = new NodeConfig(path);

      const value = await lastValueFrom(config.get("core", "repositoryformatversion"));

      expect(value).toBe("0");
    });
  });

  test("reads subsection values", async () => {
    await withTempFile(async (path) => {
      await writeFile(
        path,
        '[remote "origin"]\n\turl = https://example.com/repo.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
      );
      const config = new NodeConfig(path);

      const url = await lastValueFrom(config.get("remote", "origin.url"));
      const fetch = await lastValueFrom(config.get("remote", "origin.fetch"));

      expect(url).toBe("https://example.com/repo.git");
      expect(fetch).toBe("+refs/heads/*:refs/remotes/origin/*");
    });
  });

  test("writes values and persists them", async () => {
    await withTempFile(async (path) => {
      const config = new NodeConfig(path);

      await lastValueFrom(config.set("core", "bare", "true"));
      await lastValueFrom(config.set("remote", "origin.url", "https://example.com/repo.git"));

      const text = await readFile(path, "utf-8");
      expect(text).toContain("[core]");
      expect(text).toContain("bare = true");
      expect(text).toContain('[remote "origin"]');
      expect(text).toContain("url = https://example.com/repo.git");

      const reloaded = new NodeConfig(path);
      expect(await lastValueFrom(reloaded.get("core", "bare"))).toBe("true");
      expect(await lastValueFrom(reloaded.get("remote", "origin.url"))).toBe(
        "https://example.com/repo.git",
      );
    });
  });

  test("removes values", async () => {
    await withTempFile(async (path) => {
      const config = new NodeConfig(path);
      await lastValueFrom(config.set("core", "bare", "true"));

      await lastValueFrom(config.remove("core", "bare"));

      expect(await lastValueFrom(config.get("core", "bare"))).toBeUndefined();
    });
  });

  test("lists section entries", async () => {
    await withTempFile(async (path) => {
      const config = new NodeConfig(path);
      await lastValueFrom(config.set("remote", "origin.url", "https://origin.git"));
      await lastValueFrom(config.set("remote", "upstream.url", "https://upstream.git"));

      const entries = await lastValueFrom(config.list("remote"));

      expect(entries).toEqual([
        ["origin.url", "https://origin.git"],
        ["upstream.url", "https://upstream.git"],
      ]);
    });
  });

  test("ignores comments", async () => {
    await withTempFile(async (path) => {
      await writeFile(path, "# comment\n[core]\n\t bare = false ; inline\n");
      const config = new NodeConfig(path);

      expect(await lastValueFrom(config.get("core", "bare"))).toBe("false");
    });
  });
});

describe("isNodeNotFoundError", () => {
  test("returns true for ENOENT errors", () => {
    expect(isNodeNotFoundError({ code: "ENOENT" })).toBe(true);
  });

  test("returns false for other codes", () => {
    expect(isNodeNotFoundError({ code: "EACCES" })).toBe(false);
  });

  test("returns false for non-objects", () => {
    expect(isNodeNotFoundError("ENOENT")).toBe(false);
    expect(isNodeNotFoundError(null)).toBe(false);
  });
});

describe("readConfigEntries", () => {
  test("parses an existing config file", async () => {
    await withTempFile(async (path) => {
      await writeFile(path, "[core]\n\tversion = 1\n");

      const entries = await lastValueFrom(readConfigEntries(path));

      expect(entries).toEqual([{ section: "core", key: "version", value: "1" }]);
    });
  });

  test("returns an empty array when the file is missing", async () => {
    await withTempFile(async (path) => {
      const entries = await lastValueFrom(readConfigEntries(path));

      expect(entries).toEqual([]);
    });
  });
});

describe("replaceEntry", () => {
  const existing: ConfigEntry[] = [{ section: "core", key: "bare", value: "false" }];

  test("appends a new entry", () => {
    const updated = replaceEntry(existing, { section: "core", key: "filemode", value: "true" });

    expect(updated).toEqual([
      { section: "core", key: "bare", value: "false" },
      { section: "core", key: "filemode", value: "true" },
    ]);
  });

  test("updates an existing entry", () => {
    const updated = replaceEntry(existing, { section: "core", key: "bare", value: "true" });

    expect(updated).toEqual([{ section: "core", key: "bare", value: "true" }]);
  });
});

describe("writeConfigEntries", () => {
  test("writes serialized entries to the file", async () => {
    await withTempFile(async (path) => {
      await lastValueFrom(
        writeConfigEntries(path, [{ section: "core", key: "bare", value: "true" }]),
      );

      const text = await readFile(path, "utf-8");
      expect(text).toBe("[core]\n\tbare = true\n");
    });
  });
});

describe("parseConfig", () => {
  test("parses flat sections", () => {
    const entries = parseConfig("[core]\n\tbare = true\n");

    expect(entries).toEqual([{ section: "core", key: "bare", value: "true" }]);
  });

  test("parses subsections", () => {
    const entries = parseConfig('[remote "origin"]\n\turl = https://git.example.com\n');

    expect(entries).toEqual([{ section: "remote", key: "origin.url", value: "https://git.example.com" }]);
  });

  test("skips blank lines and comments", () => {
    const entries = parseConfig("# header\n\n[core]\n\tversion = 2 ; inline\n");

    expect(entries).toEqual([{ section: "core", key: "version", value: "2" }]);
  });

  test("ignores values outside a section", () => {
    const entries = parseConfig("orphan = value\n");

    expect(entries).toEqual([]);
  });
});

describe("stripComment", () => {
  test("removes line comments", () => {
    expect(stripComment("key = value ; comment")).toBe("key = value ");
  });

  test("removes hash comments", () => {
    expect(stripComment("# whole line comment")).toBe("");
  });

  test("preserves characters inside quotes", () => {
    expect(stripComment('value = "with # hash" ; real comment')).toBe('value = "with # hash" ');
  });
});

describe("unquote", () => {
  test("strips matching outer quotes", () => {
    expect(unquote('"hello"')).toBe("hello");
  });

  test("leaves unquoted values unchanged", () => {
    expect(unquote("hello")).toBe("hello");
  });

  test("leaves single quotes unchanged", () => {
    expect(unquote('"hello')).toBe('"hello');
  });
});

describe("serializeConfig", () => {
  test("serializes flat sections", () => {
    const text = serializeConfig([{ section: "core", key: "bare", value: "true" }]);

    expect(text).toBe("[core]\n\tbare = true\n");
  });

  test("serializes subsections", () => {
    const text = serializeConfig([{ section: "remote", key: "origin.url", value: "https://git.example.com" }]);

    expect(text).toBe('[remote "origin"]\n\turl = https://git.example.com\n');
  });

  test("quotes values that need quoting", () => {
    const text = serializeConfig([{ section: "core", key: "path", value: "/my path" }]);

    expect(text).toBe('[core]\n\tpath = "/my path"\n');
  });

  test("returns an empty string for no entries", () => {
    expect(serializeConfig([])).toBe("");
  });
});

describe("groupEntries", () => {
  test("groups by section and subsection preserving order", () => {
    const groups = groupEntries([
      { section: "core", key: "bare", value: "true" },
      { section: "remote", key: "origin.url", value: "a" },
      { section: "remote", key: "upstream.url", value: "b" },
    ]);

    expect(groups.get("core")?.get("")).toEqual([["bare", "true"]]);
    expect(groups.get("remote")?.get("origin")).toEqual([["url", "a"]]);
    expect(groups.get("remote")?.get("upstream")).toEqual([["url", "b"]]);
  });
});

describe("quoteIfNeeded", () => {
  test("leaves simple values unquoted", () => {
    expect(quoteIfNeeded("true")).toBe("true");
  });

  test("quotes values with spaces", () => {
    expect(quoteIfNeeded("hello world")).toBe('"hello world"');
  });

  test("quotes values with comment characters", () => {
    expect(quoteIfNeeded("a;b")).toBe('"a;b"');
  });

  test("quotes empty values", () => {
    expect(quoteIfNeeded("")).toBe('""');
  });

  test("escapes inner quotes", () => {
    expect(quoteIfNeeded('say "hi"')).toBe('"say \\"hi\\""');
  });
});
