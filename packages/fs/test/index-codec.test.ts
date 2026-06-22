import { describe, expect, test } from "bun:test";
import { lastValueFrom } from "rxjs";
import { Index } from "@slim-git/core";
import type { IndexEntry, Oid } from "@slim-git/types";
import {
  buildIndexEntryFlags,
  bytesToOid,
  computeChecksum,
  decodeIndex,
  decodeIndexEntry,
  encodeIndex,
  encodeIndexEntry,
  oidToBytes,
  readIndexHeader,
  readUint16,
  readUint32,
  writeTimestamp,
  writeUint16,
  writeUint32,
} from "@slim-git/fs";

const sampleOid = "3b18e512dba79e4c8300dd08aeb37f8e728b8dad" as Oid;

const createEntry = (path: string): IndexEntry => ({
  path,
  oid: sampleOid,
  mode: 0o100644,
  stage: 0,
  fileSize: 11,
  ctimeSeconds: 1,
  ctimeNanos: 0,
  mtimeSeconds: 2,
  mtimeNanos: 0,
  dev: 0,
  ino: 0,
  uid: 0,
  gid: 0,
  assumeValid: false,
  extended: false,
  skipWorktree: false,
  intentToAdd: false,
});

describe("index codec", () => {
  test("encodeIndex produces a DIRC buffer", () => {
    const index = Index.from([createEntry("a.txt")]);
    const bytes = encodeIndex(index);

    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("DIRC");
  });

  test("decodeIndex round-trips a single entry", async () => {
    const index = Index.from([createEntry("a.txt")]);
    const bytes = encodeIndex(index);

    return lastValueFrom(decodeIndex(bytes)).then((decoded) => {
      expect(decoded.paths).toEqual(["a.txt"]);
      expect(decoded.get("a.txt")).toEqual(createEntry("a.txt"));
    });
  });

  test("decodeIndex round-trips multiple entries", async () => {
    const index = Index.from([createEntry("a.txt"), createEntry("b/c.txt")]);
    const bytes = encodeIndex(index);

    return lastValueFrom(decodeIndex(bytes)).then((decoded) => {
      expect(decoded.paths).toEqual(["a.txt", "b/c.txt"]);
    });
  });

  test("decodeIndex round-trips an empty index", async () => {
    const bytes = encodeIndex(Index.empty());

    return lastValueFrom(decodeIndex(bytes)).then((decoded) => {
      expect(decoded.paths).toEqual([]);
    });
  });

  test("decodeIndex errors on short buffer", () => {
    return expect(
      lastValueFrom(decodeIndex(new Uint8Array([0, 1, 2]))),
    ).rejects.toThrow();
  });

  test("decodeIndex errors on bad signature", () => {
    const bytes = new TextEncoder().encode("XXXX");
    return expect(lastValueFrom(decodeIndex(bytes))).rejects.toThrow();
  });

  test("decodeIndex errors on unsupported version", () => {
    const bytes = new Uint8Array(12);
    bytes.set(new TextEncoder().encode("DIRC"), 0);
    new DataView(bytes.buffer).setUint32(4, 99, false);

    return expect(lastValueFrom(decodeIndex(bytes))).rejects.toThrow();
  });

  test("readIndexHeader returns entry count", async () => {
    const bytes = encodeIndex(
      Index.from([createEntry("a.txt"), createEntry("b.txt")]),
    );

    return lastValueFrom(readIndexHeader(bytes)).then((header) => {
      expect(header.entryCount).toBe(2);
    });
  });

  test("readIndexHeader errors on bad signature", () => {
    const bytes = new TextEncoder().encode("XXXX");
    return expect(lastValueFrom(readIndexHeader(bytes))).rejects.toThrow();
  });

  test("encodeIndexEntry and decodeIndexEntry round-trip", () => {
    const entry = createEntry("nested/path.txt");
    const bytes = encodeIndexEntry(entry);

    const { entry: decoded, bytesRead } = decodeIndexEntry(bytes, 0);

    expect(decoded).toEqual(entry);
    expect(bytesRead).toBe(bytes.length);
  });

  test("oidToBytes and bytesToOid round-trip", () => {
    const bytes = oidToBytes(sampleOid);
    expect(bytes.length).toBe(20);
    expect(bytesToOid(bytes)).toBe(sampleOid);
  });

  test("writeUint32 and readUint32 round-trip", () => {
    const buffer = new Uint8Array(4);
    writeUint32(buffer, 0, 0x12345678);
    expect(readUint32(buffer, 0)).toBe(0x12345678);
  });

  test("writeUint16 and readUint16 round-trip", () => {
    const buffer = new Uint8Array(2);
    writeUint16(buffer, 0, 0xabcd);
    expect(readUint16(buffer, 0)).toBe(0xabcd);
  });

  test("writeTimestamp writes seconds then nanoseconds", () => {
    const buffer = new Uint8Array(8);
    writeTimestamp(buffer, 0, 123, 456);
    expect(readUint32(buffer, 0)).toBe(123);
    expect(readUint32(buffer, 4)).toBe(456);
  });

  test("computeChecksum produces 20-byte SHA-1", () => {
    const data = new TextEncoder().encode("hello");
    const checksum = computeChecksum(data);
    expect(checksum.length).toBe(20);
  });

  test("buildIndexEntryFlags encodes stage and assumeValid", () => {
    const entry: IndexEntry = {
      ...createEntry("x.txt"),
      stage: 2,
      assumeValid: true,
    };
    const flags = buildIndexEntryFlags(entry);
    expect((flags >> 12) & 0x03).toBe(2);
    expect(flags & 0x8000).toBe(0x8000);
    expect(flags & 0x0fff).toBe("x.txt".length);
  });
});
