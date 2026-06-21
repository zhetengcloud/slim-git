import { describe, expect, test } from "bun:test";
import { decodePktLines, encodeFlushPacket, encodePktLine, encodePktLines } from "@slim-git/http";

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("pkt-line", () => {
  test("encodes a single line", () => {
    const encoded = encodePktLine("hello");

    expect(text(encoded)).toBe("000ahello\n");
  });

  test("encodes a flush packet", () => {
    expect(text(encodeFlushPacket())).toBe("0000");
  });

  test("encodes multiple lines with flush packet", () => {
    const encoded = encodePktLines(["a", "b"]);

    expect(text(encoded)).toBe("0006a\n0006b\n0000");
  });

  test("decodes a single line", () => {
    const { lines, remainder } = decodePktLines(new TextEncoder().encode("000ahello\n"));

    expect(lines).toEqual(["hello"]);
    expect(remainder).toHaveLength(0);
  });

  test("decodes lines and skips flush packets", () => {
    const { lines } = decodePktLines(new TextEncoder().encode("0006a\n0006b\n0000"));

    expect(lines).toEqual(["a", "b"]);
  });

  test("preserves remainder bytes for incomplete frames", () => {
    const { lines, remainder } = decodePktLines(new TextEncoder().encode("0006a\n000"));

    expect(lines).toEqual(["a"]);
    expect(text(remainder)).toBe("000");
  });

  test("combines remainder with next chunk", () => {
    const first = decodePktLines(new TextEncoder().encode("0006a\n000"));
    const second = decodePktLines(new TextEncoder().encode("6b\n0000"), first.remainder);

    expect(second.lines).toEqual(["b"]);
  });

  test("throws on invalid length", () => {
    expect(() => decodePktLines(new TextEncoder().encode("0001x"))).toThrow();
  });
});
