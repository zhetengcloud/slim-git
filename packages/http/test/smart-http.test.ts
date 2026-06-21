import { describe, expect, test } from "bun:test";
import type { Oid } from "@slim-git/types";
import { encodePktLines, parseRefDiscovery, SmartHttpTransport } from "@slim-git/http";

const oid = "d82a7b2e6c1a9f4b8c3d5e7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const topicOid = `${oid}1`;

const discoveryResponse = new TextDecoder().decode(
  new Uint8Array([
    ...new TextEncoder().encode("001e# service=git-upload-pack\n"),
    ...new TextEncoder().encode("0000"),
    ...encodePktLines([
      `${oid} HEAD\0multi_ack side-band ofs-delta`,
      `${oid} refs/heads/main`,
      `${topicOid} refs/heads/topic`,
    ]),
  ]),
);

describe("parseRefDiscovery", () => {
  test("parses the service announcement, refs, and capabilities", () => {
    const result = parseRefDiscovery(
      new TextEncoder().encode(discoveryResponse),
      "git-upload-pack",
    );

    expect(result.service).toBe("git-upload-pack");
    expect(result.refs).toEqual([
      {
        name: "HEAD",
        oid: "d82a7b2e6c1a9f4b8c3d5e7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" as Oid,
      },
      {
        name: "refs/heads/main",
        oid: "d82a7b2e6c1a9f4b8c3d5e7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" as Oid,
      },
      {
        name: "refs/heads/topic",
        oid: "d82a7b2e6c1a9f4b8c3d5e7a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b01" as Oid,
      },
    ]);
    expect(result.capabilities).toContain("multi_ack");
    expect(result.capabilities).toContain("side-band");
    expect(result.capabilities).toContain("ofs-delta");
  });

  test("throws on unexpected service", () => {
    expect(() =>
      parseRefDiscovery(new TextEncoder().encode(discoveryResponse), "git-receive-pack"),
    ).toThrow();
  });
});

describe("SmartHttpTransport", () => {
  test("buildFetchRequest creates want/have/done lines", () => {
    const request = SmartHttpTransport.buildFetchRequest(["want1", "want2"], ["have1"]);

    expect(new TextDecoder().decode(request)).toBe(
      "001dwant want1 side-band-64k\n000fwant want2\n000fhave have1\n0009done\n0000",
    );
  });

  test("buildPushRequest creates commands followed by packfile", () => {
    const packfile = new TextEncoder().encode("PACK");
    const request = SmartHttpTransport.buildPushRequest(
      [{ ref: "refs/heads/main", oldOid: "0000", newOid: "newoid" }],
      packfile,
    );

    expect(new TextDecoder().decode(request.slice(0, -packfile.length))).toBe(
      "00200000 newoid refs/heads/main\n0000",
    );
    expect(request.slice(-packfile.length)).toEqual(packfile);
  });
});
