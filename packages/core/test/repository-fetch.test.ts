import { describe, expect, test } from "bun:test";
import { concatMap, defaultIfEmpty, forkJoin, lastValueFrom, of } from "rxjs";
import type { Repository } from "@slim-git/core";
import { Repository as RepositoryImpl } from "@slim-git/core";
import {
  MemoryBackend,
  MemoryConfig,
  MemoryIndexStore,
  MemoryRefStore,
  MemoryTransport,
  MemoryWorkspaceBackend,
} from "@slim-git/memory";

const person = {
  name: "Dev",
  email: "dev@example.com",
  timestamp: new Date(0),
  timezoneOffsetMinutes: 0,
};

const createRepo = async (backend = new MemoryBackend()): Promise<Repository> =>
  lastValueFrom(
    RepositoryImpl.init(backend, {
      refs: new MemoryRefStore(),
      index: new MemoryIndexStore(),
      workspace: new MemoryWorkspaceBackend(),
      config: new MemoryConfig(),
    }),
  );

const createRemoteRepo = async (
  files: Record<string, string>,
): Promise<{ repo: Repository; backend: MemoryBackend; refs: Map<string, string> }> => {
  const backend = new MemoryBackend();
  const refs = new Map<string, string>();
  const repo = await createRepo(backend);
  await lastValueFrom(
    forkJoin(
      Object.entries(files).map(([path, content]) =>
        repo.workspace.writeFile(path, new TextEncoder().encode(content)),
      ),
    ).pipe(defaultIfEmpty([])),
  );
  await lastValueFrom(repo.add(Object.keys(files)));
  await lastValueFrom(repo.commit({ message: "Initial", author: person }));
  await lastValueFrom(
    repo.resolveRef("HEAD").pipe(
      concatMap((oid) => {
        if (oid === undefined) return of(undefined);
        refs.set("refs/heads/main", oid);
        return repo.refs.write("refs/heads/main", oid);
      }),
    ),
  );
  return { repo, backend, refs };
};

const createTransport = (refs: Map<string, string>, backend: MemoryBackend): MemoryTransport =>
  new MemoryTransport(refs, backend);

describe("Repository fetch/push/pull", () => {
  test("fetch copies remote objects and writes a remote-tracking ref", async () => {
    const {
      repo: remote,
      backend: remoteBackend,
      refs: remoteRefs,
    } = await createRemoteRepo({ "a.txt": "hello" });
    const remoteOid = await lastValueFrom(remote.resolveRef("HEAD"));
    const transport = createTransport(remoteRefs, remoteBackend);
    const local = await createRepo();

    const result = await lastValueFrom(local.fetch("origin", transport, { ref: "main" }));

    expect(result.fetched).toHaveLength(1);
    expect(result.fetched[0]?.ref).toBe("refs/heads/main");
    expect(result.fetched[0]?.oid).toBe(remoteOid);
    expect(await lastValueFrom(local.refs.read("refs/remotes/origin/main"))).toBe(remoteOid);
    expect(await lastValueFrom(local.objectStore.exists(remoteOid!))).toBe(true);
  });

  test("push sends local objects and updates the remote ref", async () => {
    const { backend: remoteBackend, refs: remoteRefs } = await createRemoteRepo({
      "a.txt": "hello",
    });
    const transport = createTransport(remoteRefs, remoteBackend);
    const local = await createRepo();

    await lastValueFrom(local.fetch("origin", transport, { ref: "main" }));
    const baseOid = await lastValueFrom(local.resolveRef("refs/remotes/origin/main"));
    await lastValueFrom(local.createBranch("main", { target: baseOid }));
    await lastValueFrom(local.checkout("main"));
    await lastValueFrom(local.workspace.writeFile("b.txt", new TextEncoder().encode("world")));
    await lastValueFrom(local.add(["b.txt"]));
    const newOid = await lastValueFrom(local.commit({ message: "Add b", author: person }));

    const result = await lastValueFrom(local.push("origin", transport, { ref: "main" }));

    expect(result.pushed).toHaveLength(1);
    expect(result.pushed[0]?.accepted).toBe(true);
    expect(remoteRefs.get("refs/heads/main")).toBe(newOid);
    expect(await lastValueFrom(remoteBackend.exists(newOid))).toBe(true);
  });

  test("pull fast-forwards the current branch", async () => {
    const {
      repo: remote,
      backend: remoteBackend,
      refs: remoteRefs,
    } = await createRemoteRepo({ "a.txt": "hello" });
    await lastValueFrom(remote.workspace.writeFile("b.txt", new TextEncoder().encode("world")));
    await lastValueFrom(remote.add(["b.txt"]));
    const remoteHead = await lastValueFrom(remote.commit({ message: "Add b", author: person }));
    remoteRefs.set("refs/heads/main", remoteHead);
    await lastValueFrom(remote.refs.write("refs/heads/main", remoteHead));
    const transport = createTransport(remoteRefs, remoteBackend);

    const local = await createRepo();
    await lastValueFrom(local.fetch("origin", transport, { ref: "main" }));
    const baseOid = await lastValueFrom(local.resolveRef("refs/remotes/origin/main"));
    await lastValueFrom(local.createBranch("main", { target: baseOid }));
    await lastValueFrom(local.checkout("main"));

    const result = await lastValueFrom(local.pull("origin", transport, { ref: "main" }));

    expect(result.fetch.fetched).toHaveLength(1);
    expect(result.fetch.fetched[0]?.oid).toBe(remoteHead);
    expect(result.merge.merged).toBe(true);
    expect(result.merge.commitOid).toBe(remoteHead);
    expect(await lastValueFrom(local.resolveRef("HEAD"))).toBe(remoteHead);
  });
});
