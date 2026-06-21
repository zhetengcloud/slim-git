import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import type { Oid } from "@slim-git/types";
import { ObjectStore, Sha1Hash, TreeBuilder } from "@slim-git/core";
import { MemoryBackend } from "@slim-git/memory";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * True if the canonical `git` CLI is available on this machine.
 * The whole suite is skipped when it is not, so CI environments without Git
 * still pass cleanly.
 */
const hasGit = ((): boolean => {
  try {
    const result = Bun.spawnSync({ cmd: ["git", "--version"] });
    return result.success;
  } catch {
    return false;
  }
})();

/** Runs a `git` subcommand with the given stdin in a specific working directory. */
const runGit = (cwd: string, input: string, ...args: string[]): string => {
  const result = Bun.spawnSync({
    cmd: ["git", "-C", cwd, ...args],
    stdin: new TextEncoder().encode(input),
  });
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
  return new TextDecoder().decode(result.stdout).trim();
};

/** Creates a temporary Git repository so `git mktree` can resolve object oids. */
const createTempRepo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "slim-git-roundtrip-"));
  Bun.spawnSync({ cmd: ["git", "init", "-q", dir] });
  return dir;
};

/**
 * Integration tests that compare slim-git object ids with canonical `git`.
 *
 * These tests guard the core object model: if hashing or tree serialization
 * drift from Git's format, the resulting oids would no longer be compatible
 * with real Git repositories.
 */
describe.skipIf(!hasGit)("Git round-trip", () => {
  test("blob hash matches canonical git", () => {
    const content = new TextEncoder().encode("hello\n");
    const object = Sha1Hash.hashObject("blob", content);
    const canonical = runGit(createTempRepo(), "hello\n", "hash-object", "--stdin");

    expect(object.oid).toBe(canonical as Oid);
  });

  test("tree oid matches canonical git mktree", async () => {
    const store = new ObjectStore(new MemoryBackend(), Sha1Hash);
    const a = await lastValueFrom(store.write("blob", new TextEncoder().encode("a\n")));
    const b = await lastValueFrom(store.write("blob", new TextEncoder().encode("b\n")));

    const treeOid = await lastValueFrom(
      new TreeBuilder()
        .insert("a.txt", a.oid, 0o100644)
        .insert("b.txt", b.oid, 0o100644)
        .build(store),
    );

    // `git mktree` needs the blob objects to exist in the temporary repo.
    const repo = createTempRepo();
    runGit(repo, "a\n", "hash-object", "-w", "--stdin");
    runGit(repo, "b\n", "hash-object", "-w", "--stdin");

    const canonicalInput = [`100644 blob ${a.oid}\ta.txt`, `100644 blob ${b.oid}\tb.txt`, ""].join(
      "\n",
    );
    const canonical = runGit(repo, canonicalInput, "mktree");

    expect(treeOid).toBe(canonical as Oid);
  });
});
