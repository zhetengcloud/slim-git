import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import type { GitObject, Oid, Repository } from "@slim-git/core";
import { parseTreeEntries, Repository as RepositoryImpl } from "@slim-git/core";
import {
  MemoryBackend,
  MemoryConfig,
  MemoryIndexStore,
  MemoryRefStore,
  MemoryWorkspaceBackend,
} from "@slim-git/memory";
import { buildPackfile, encodePktLines, parsePackfile, SmartHttpTransport } from "@slim-git/http";

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

const commitFile = async (
  repo: Repository,
  path: string,
  content: string,
  message: string,
): Promise<Oid> => {
  await lastValueFrom(repo.workspace.writeFile(path, new TextEncoder().encode(content)));
  await lastValueFrom(repo.add([path]));
  return lastValueFrom(repo.commit({ message, author: person }));
};

const collectObjects = async (repo: Repository, headOid: Oid): Promise<GitObject[]> => {
  const objects = new Map<Oid, GitObject>();

  const visit = async (oid: Oid): Promise<void> => {
    if (objects.has(oid)) return;
    const object = await lastValueFrom(repo.objectStore.read(oid));
    objects.set(oid, object);

    if (object.type === "commit") {
      const text = new TextDecoder().decode(object.content);
      const parentMatches = text.match(/^parent ([0-9a-f]{40})$/gim);
      if (parentMatches !== null) {
        for (const match of parentMatches) {
          await visit(match.split(" ")[1]! as Oid);
        }
      }
      const treeMatch = text.match(/^tree ([0-9a-f]{40})$/im);
      if (treeMatch !== null) {
        await visit(treeMatch[1]! as Oid);
      }
    } else if (object.type === "tree") {
      for (const entry of parseTreeEntries(object.content).values()) {
        await visit(entry.oid);
      }
    }
  };

  await visit(headOid);
  return Array.from(objects.values());
};

const encodeSidebandFrame = (channel: number, data: Uint8Array): Uint8Array => {
  const length = 4 + 1 + data.length;
  const result = new Uint8Array(length);
  const lengthBytes = new TextEncoder().encode(length.toString(16).padStart(4, "0"));
  result.set(lengthBytes);
  result[4] = channel;
  result.set(data, 5);
  return result;
};

const zeroOid = "0000000000000000000000000000000000000000" as Oid;

/**
 * Splits a push request body into the text commands and the trailing packfile.
 *
 * The command section is a pkt-line stream terminated by a flush packet (0000);
 * everything after the flush is the packfile bytes.
 */
const splitPushRequest = (
  data: Uint8Array,
): { readonly commands: readonly string[]; readonly packfile: Uint8Array } => {
  let position = 0;
  const commands: string[] = [];

  while (position + 4 <= data.length) {
    const lengthText = new TextDecoder().decode(data.slice(position, position + 4));

    if (lengthText === "0000") {
      position += 4;
      return { commands, packfile: data.slice(position) };
    }

    const length = Number.parseInt(lengthText, 16);
    if (Number.isNaN(length) || length < 4) {
      throw new Error(`Invalid pkt-line length: ${lengthText}`);
    }

    const payload = data.slice(position + 4, position + length);
    commands.push(new TextDecoder().decode(payload).replace(/\n$/, ""));
    position += length;
  }

  throw new Error("Missing flush packet in push request");
};

describe("SmartHttpTransport integration", () => {
  test("fetch receives remote objects through a mock upload-pack server", async () => {
    const remoteBackend = new MemoryBackend();
    const remote = await createRepo(remoteBackend);
    const headOid = await commitFile(remote, "a.txt", "hello", "Initial");

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/info/refs") {
          const body = new Uint8Array([
            ...new TextEncoder().encode("001e# service=git-upload-pack\n"),
            ...new TextEncoder().encode("0000"),
            ...encodePktLines([`${headOid} refs/heads/main`]),
          ]);
          return new Response(body, {
            headers: { "Content-Type": "application/x-git-upload-pack-advertisement" },
          });
        }

        if (url.pathname === "/git-upload-pack") {
          const objects = await collectObjects(remote, headOid);
          const packfile = buildPackfile(objects);
          const body = new Uint8Array([
            ...encodeSidebandFrame(1, new TextEncoder().encode("NAK\n")),
            ...encodeSidebandFrame(1, packfile),
          ]);
          return new Response(body, {
            headers: { "Content-Type": "application/x-git-upload-pack-result" },
          });
        }

        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const local = await createRepo();
      const transport = new SmartHttpTransport(`http://localhost:${server.port}`);
      const result = await lastValueFrom(local.fetch("origin", transport, { ref: "main" }));

      expect(result.fetched).toHaveLength(1);
      expect(result.fetched[0]?.ref).toBe("refs/heads/main");
      expect(result.fetched[0]?.oid).toBe(headOid);
      expect(await lastValueFrom(local.refs.read("refs/remotes/origin/main"))).toBe(headOid);
      expect(await lastValueFrom(local.objectStore.exists(headOid))).toBe(true);
    } finally {
      server.stop();
    }
  });

  test("push sends objects through a mock receive-pack server", async () => {
    const remoteBackend = new MemoryBackend();
    const remote = await createRepo(remoteBackend);
    const remoteRefs = new Map<string, string>();

    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/info/refs") {
          const body = new Uint8Array([
            ...new TextEncoder().encode("001f# service=git-receive-pack\n"),
            ...new TextEncoder().encode("0000"),
            ...encodePktLines([`${zeroOid} refs/heads/main`]),
          ]);
          return new Response(body, {
            headers: { "Content-Type": "application/x-git-receive-pack-advertisement" },
          });
        }

        if (url.pathname === "/git-receive-pack") {
          const requestBytes = new Uint8Array(await req.arrayBuffer());
          const { commands, packfile } = splitPushRequest(requestBytes);
          const objects = await parsePackfile(packfile, remote.objectStore.hashAlgorithm);

          for (const object of objects) {
            await lastValueFrom(remoteBackend.writeObject(object));
          }

          for (const command of commands) {
            const parts = command.split(" ");
            const ref = parts[2];
            const newOid = parts[1];
            if (ref !== undefined && newOid !== undefined) {
              remoteRefs.set(ref, newOid);
            }
          }

          const report = encodePktLines(["unpack ok", "ok refs/heads/main"]);
          return new Response(report, {
            headers: { "Content-Type": "application/x-git-receive-pack-result" },
          });
        }

        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const local = await createRepo();
      const newOid = await commitFile(local, "a.txt", "hello", "Initial");
      await lastValueFrom(local.createBranch("main", { target: newOid }));
      await lastValueFrom(local.checkout("main"));

      const transport = new SmartHttpTransport(`http://localhost:${server.port}`);
      const result = await lastValueFrom(local.push("origin", transport, { ref: "main" }));

      expect(result.pushed).toHaveLength(1);
      expect(result.pushed[0]?.accepted).toBe(true);
      expect(remoteRefs.get("refs/heads/main")).toBe(newOid);
      expect(await lastValueFrom(remoteBackend.exists(newOid))).toBe(true);
    } finally {
      server.stop();
    }
  });
});
