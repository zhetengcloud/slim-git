import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import type { Oid } from "@slim-git/types";
import { MemoryBackend } from "./index.js";
import { MemoryTransport } from "./transport.js";

const oid = (value: string): Oid => value as Oid;
const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
};

describe("MemoryTransport", () => {
  test("discovers remote refs", async () => {
    const refs = new Map<string, string>([
      ["refs/heads/main", "1111111111111111111111111111111111111111"],
    ]);
    const transport = new MemoryTransport(refs, new MemoryBackend());

    const discovered = await lastValueFrom(transport.discoverRefs());

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.name).toBe("refs/heads/main");
    expect(discovered[0]?.oid).toBe(oid("1111111111111111111111111111111111111111"));
  });

  test("fetch walks commit parents and trees", async () => {
    const backend = new MemoryBackend();
    const encoder = new TextEncoder();

    const blob = await lastValueFrom(
      backend.writeObject({ type: "blob", content: encoder.encode("hello"), oid: oid("") }),
    );
    const treeContent = new Uint8Array([
      ...encoder.encode("100644 a.txt\0"),
      ...hexToBytes(blob.oid),
    ]);
    const tree = await lastValueFrom(
      backend.writeObject({ type: "tree", content: treeContent, oid: oid("") }),
    );
    const commitContent = encoder.encode(
      `tree ${tree.oid}\nauthor Dev <dev@example.com> 0 +0000\ncommitter Dev <dev@example.com> 0 +0000\n\nInitial`,
    );
    const commit = await lastValueFrom(
      backend.writeObject({ type: "commit", content: commitContent, oid: oid("") }),
    );

    const refs = new Map<string, string>([["refs/heads/main", commit.oid]]);
    const transport = new MemoryTransport(refs, backend);

    const fetched = await lastValueFrom(transport.fetch([commit.oid]));
    const oids = fetched.map((object) => object.oid);

    expect(oids).toContain(commit.oid);
    expect(oids).toContain(tree.oid);
    expect(oids).toContain(blob.oid);
  });

  test("push writes objects and updates refs", async () => {
    const backend = new MemoryBackend();
    const localObject = await lastValueFrom(
      backend.writeObject({
        type: "blob",
        content: new TextEncoder().encode("x"),
        oid: oid(""),
      }),
    );
    const refs = new Map<string, string>();
    const transport = new MemoryTransport(refs, backend);

    const report = await lastValueFrom(
      transport.push(
        [
          {
            ref: "refs/heads/main",
            oldOid: oid("0000000000000000000000000000000000000000"),
            newOid: localObject.oid,
          },
        ],
        [localObject],
      ),
    );

    expect(report.accepted).toHaveLength(1);
    expect(report.accepted[0]?.accepted).toBe(true);
    expect(refs.get("refs/heads/main")).toBe(localObject.oid);
    expect(await lastValueFrom(backend.exists(localObject.oid))).toBe(true);
  });
});
