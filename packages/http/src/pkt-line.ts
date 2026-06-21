/**
 * Git "pkt-line" format helpers.
 *
 * A pkt-line is a length-prefixed frame used by the Smart HTTP protocol.
 * The first four bytes are lowercase hex digits giving the total frame length
 * (including the four length bytes and a trailing LF). A length of "0000" is a
 * flush packet that terminates a section.
 */

/** Encodes a single payload string into a pkt-line. */
export const encodePktLine = (payload: string): Uint8Array => {
  const payloadBytes = new TextEncoder().encode(`${payload}\n`);
  const length = 4 + payloadBytes.length;
  const result = new Uint8Array(length);
  const lengthBytes = new TextEncoder().encode(length.toString(16).padStart(4, "0"));
  result.set(lengthBytes);
  result.set(payloadBytes, 4);
  return result;
};

/** Encodes a flush packet. */
export const encodeFlushPacket = (): Uint8Array => new TextEncoder().encode("0000");

/** Encodes multiple payload lines followed by a flush packet. */
export const encodePktLines = (payloads: readonly string[]): Uint8Array => {
  const lines = payloads.map(encodePktLine);
  const flush = encodeFlushPacket();
  const total = lines.reduce((sum, line) => sum + line.length, 0) + flush.length;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const line of lines) {
    result.set(line, offset);
    offset += line.length;
  }
  result.set(flush, offset);
  return result;
};

/** Result of decoding a pkt-line stream. */
export interface DecodedPktLines {
  readonly lines: readonly string[];
  readonly remainder: Uint8Array;
}

/**
 * Decodes pkt-lines from a byte chunk.
 * Returns the decoded payload lines (without trailing LF) and any incomplete
 * trailing bytes that could not form a full frame.
 */
export const decodePktLines = (
  data: Uint8Array,
  previousRemainder?: Uint8Array,
): DecodedPktLines => {
  const buffer =
    previousRemainder !== undefined ? concatUint8Arrays(previousRemainder, data) : data;

  const lines: string[] = [];
  let position = 0;

  while (position < buffer.length) {
    if (position + 4 > buffer.length) {
      break;
    }

    const lengthText = new TextDecoder().decode(buffer.slice(position, position + 4));
    if (lengthText === "0000") {
      position += 4;
      continue;
    }

    const length = Number.parseInt(lengthText, 16);
    if (Number.isNaN(length) || length < 4) {
      throw new Error(`Invalid pkt-line length: ${lengthText}`);
    }

    if (position + length > buffer.length) {
      break;
    }

    const payloadEnd = position + length;
    const payloadBytes = buffer.slice(position + 4, payloadEnd);
    const payload = new TextDecoder().decode(stripTrailingLf(payloadBytes));
    lines.push(payload);
    position = payloadEnd;
  }

  return { lines, remainder: buffer.slice(position) };
};

const concatUint8Arrays = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
};

const stripTrailingLf = (data: Uint8Array): Uint8Array => {
  if (data.length > 0 && data[data.length - 1] === 0x0a) {
    return data.slice(0, -1);
  }
  return data;
};
