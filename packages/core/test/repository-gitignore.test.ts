import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { createMemoryRepository } from "@slim-git/memory";

describe("Repository .gitignore integration", () => {
  test("status hides ignored untracked files", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await lastValueFrom(
      repo.workspace.writeFile(".gitignore", new TextEncoder().encode("*.log\n")),
    );
    await lastValueFrom(
      repo.workspace.writeFile("tracked.txt", new TextEncoder().encode("tracked")),
    );
    await lastValueFrom(repo.workspace.writeFile("debug.log", new TextEncoder().encode("ignored")));

    const status = await lastValueFrom(repo.status());

    expect(status.untracked).toContain("tracked.txt");
    expect(status.untracked).not.toContain("debug.log");
    expect(status.untracked).toContain(".gitignore");
  });

  test("add skips ignored files", async () => {
    const repo = await lastValueFrom(createMemoryRepository());
    await lastValueFrom(
      repo.workspace.writeFile(".gitignore", new TextEncoder().encode("*.log\n")),
    );
    await lastValueFrom(
      repo.workspace.writeFile("tracked.txt", new TextEncoder().encode("tracked")),
    );
    await lastValueFrom(repo.workspace.writeFile("debug.log", new TextEncoder().encode("ignored")));

    const result = await lastValueFrom(repo.add(["tracked.txt", "debug.log"]));

    expect(result.added).toEqual(["tracked.txt"]);
    const status = await lastValueFrom(repo.status());
    expect(status.staged).toContain("tracked.txt");
    expect(status.untracked).not.toContain("debug.log");
  });
});
