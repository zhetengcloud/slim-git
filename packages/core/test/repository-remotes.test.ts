import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { createMemoryRepository } from "@slim-git/memory";

describe("Repository remotes", () => {
  test("addRemote stores the remote URL", async () => {
    const repo = await lastValueFrom(createMemoryRepository());

    await lastValueFrom(repo.addRemote("origin", "https://example.com/repo.git"));

    const remotes = await lastValueFrom(repo.listRemotes());
    expect(remotes).toEqual([{ name: "origin", url: "https://example.com/repo.git" }]);
  });

  test("listRemotes returns remotes sorted by name", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await lastValueFrom(repo.addRemote("upstream", "https://upstream.git"));
    await lastValueFrom(repo.addRemote("origin", "https://origin.git"));

    const remotes = await lastValueFrom(repo.listRemotes());

    expect(remotes).toEqual([
      { name: "origin", url: "https://origin.git" },
      { name: "upstream", url: "https://upstream.git" },
    ]);
  });

  test("removeRemote deletes the remote", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await lastValueFrom(repo.addRemote("origin", "https://example.com/repo.git"));

    await lastValueFrom(repo.removeRemote("origin"));

    const remotes = await lastValueFrom(repo.listRemotes());
    expect(remotes).toEqual([]);
  });

  test("removeRemote only deletes matching remote", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await lastValueFrom(repo.addRemote("origin", "https://origin.git"));
    await lastValueFrom(repo.addRemote("upstream", "https://upstream.git"));

    await lastValueFrom(repo.removeRemote("origin"));

    const remotes = await lastValueFrom(repo.listRemotes());
    expect(remotes).toEqual([{ name: "upstream", url: "https://upstream.git" }]);
  });

  test("ignores non-url remote config entries", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await lastValueFrom(repo.addRemote("origin", "https://example.com/repo.git"));
    await lastValueFrom(repo.config.set("remote", "origin.fetch", "+refs/heads/*:refs/remotes/origin/*"));

    const remotes = await lastValueFrom(repo.listRemotes());
    expect(remotes).toEqual([{ name: "origin", url: "https://example.com/repo.git" }]);
  });
});
