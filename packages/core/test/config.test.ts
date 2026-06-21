import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { MemoryConfig } from "@slim-git/memory";

describe("MemoryConfig", () => {
  test("returns undefined for missing keys", async () => {
    const config = new MemoryConfig();
    expect(await lastValueFrom(config.get("remote", "origin.url"))).toBeUndefined();
  });

  test("stores and reads a value", async () => {
    const config = new MemoryConfig();
    await lastValueFrom(config.set("remote", "origin.url", "https://example.com/repo.git"));

    expect(await lastValueFrom(config.get("remote", "origin.url"))).toBe(
      "https://example.com/repo.git",
    );
  });

  test("removes a value", async () => {
    const config = new MemoryConfig();
    await lastValueFrom(config.set("remote", "origin.url", "https://example.com/repo.git"));
    await lastValueFrom(config.remove("remote", "origin.url"));

    expect(await lastValueFrom(config.get("remote", "origin.url"))).toBeUndefined();
  });

  test("lists all keys in a section", async () => {
    const config = new MemoryConfig();
    await lastValueFrom(config.set("remote", "origin.url", "https://a.git"));
    await lastValueFrom(config.set("remote", "upstream.url", "https://b.git"));
    await lastValueFrom(config.set("core", "bare", "true"));

    const entries = await lastValueFrom(config.list("remote"));

    expect(entries).toEqual([
      ["origin.url", "https://a.git"],
      ["upstream.url", "https://b.git"],
    ]);
  });
});
