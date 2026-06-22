import { describe, expect, test } from "bun:test";
import {
  buildObjectBytes,
  bytesToHex,
  concatBytes,
  concatChunks,
  parseObjectBytes,
  readUint16,
  readUint32,
  writeUint16,
  writeUint32,
} from "@slim-git/core";

describe("bytes", () => {
  test("concatBytes joins two arrays", () => {
    const result = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3, 4]));

    expect(result).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  test("bytesToHex converts bytes to lowercase hex", () => {
    expect(bytesToHex(new Uint8Array([0xab, 0xcd, 0xef]))).toBe("abcdef");
  });

  test("bytesToHex pads single-digit nibbles", () => {
    expect(bytesToHex(new Uint8Array([0x01, 0x02]))).toBe("0102");
  });

  test("buildObjectBytes creates canonical object bytes", () => {
    const content = new TextEncoder().encode("hello");
    const bytes = buildObjectBytes("blob", content);
    const nullIndex = bytes.indexOf(0);

    expect(new TextDecoder().decode(bytes.slice(0, nullIndex))).toBe("blob 5");
    expect(bytes.slice(nullIndex + 1)).toEqual(content);
  });

  test("parseObjectBytes reverses buildObjectBytes", () => {
    const content = new TextEncoder().encode("tree data");
    const bytes = buildObjectBytes("tree", content);

    const parsed = parseObjectBytes(bytes);

    expect(parsed.type).toBe("tree");
    expect(parsed.content).toEqual(content);
  });

  test("parseObjectBytes throws on malformed header", () => {
    expect(() => parseObjectBytes(new TextEncoder().encode("not valid"))).toThrow(
      "Invalid object header",
    );
  });

  test("parseObjectBytes throws on size mismatch", () => {
    const bytes = new TextEncoder().encode("blob 99\0hi");

    expect(() => parseObjectBytes(bytes)).toThrow("Object size mismatch");
  });

  test("writeUint32 and readUint32 round-trip", () => {
    const bytes = writeUint32(0x12345678);

    expect(bytes).toEqual(new Uint8Array([0x12, 0x34, 0x56, 0x78]));
    expect(readUint32(bytes, 0)).toBe(0x12345678);
  });

  test("writeUint16 and readUint16 round-trip", () => {
    const bytes = writeUint16(0xabcd);

    expect(bytes).toEqual(new Uint8Array([0xab, 0xcd]));
    expect(readUint16(bytes, 0)).toBe(0xabcd);
  });

  test("concatChunks flattens an array of chunks", () => {
    const result = concatChunks([
      new Uint8Array([1, 2]),
      new Uint8Array([3]),
      new Uint8Array([4, 5]),
    ]);

    expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  test("concatChunks returns an empty array for no chunks", () => {
    expect(concatChunks([])).toEqual(new Uint8Array(0));
  });
});
