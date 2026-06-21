import type { GitObject, Oid } from "@slim-git/types";
import type { DiscoveredRef, PushCommand, PushReport, Transport } from "@slim-git/core";
import { Sha1Hash, type HashAlgorithm } from "@slim-git/core";
import { concatMap, from, map, type Observable, throwError } from "rxjs";
import { buildPackfile, parsePackfile } from "./packfile.js";
import { decodePktLines, decodePktLineFrames, encodePktLines } from "./pkt-line.js";

/** Result of the initial ref discovery exchange. */
export interface RefDiscovery {
  readonly service: "git-upload-pack" | "git-receive-pack";
  readonly refs: readonly DiscoveredRef[];
  readonly capabilities: readonly string[];
}

/** Options for constructing a {@link SmartHttpTransport}. */
export interface SmartHttpOptions {
  /** Hash algorithm used to identify objects on the remote. Defaults to SHA-1. */
  readonly hashAlgorithm?: HashAlgorithm;
  /** Additional headers sent with every HTTP request (e.g. authorization tokens). */
  readonly headers?: Record<string, string>;
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * Smart HTTP transport for Git.
 *
 * Implements the core {@link Transport} interface so it can be passed to
 * `Repository.fetch`, `Repository.push`, and `Repository.pull`. It speaks the
 * canonical Git Smart HTTP protocol over HTTP(S), including ref discovery,
 * fetch pack negotiation, and push report-status parsing.
 *
 * Pushed objects are sent undeltified to keep the implementation small. Fetched
 * packfiles are fully parsed, including `OBJ_OFS_DELTA` and `OBJ_REF_DELTA`.
 */
export class SmartHttpTransport implements Transport {
  readonly name = "smart-http";

  private readonly baseUrl: string;
  private readonly hashAlgorithm: HashAlgorithm;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, options: SmartHttpOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.hashAlgorithm = options.hashAlgorithm ?? Sha1Hash;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /**
   * Discovers refs advertised by the remote for `git-upload-pack`.
   *
   * Performs a `GET /info/refs?service=git-upload-pack` request and parses the
   * pkt-line ref advertisement.
   */
  discoverRefs(): Observable<readonly DiscoveredRef[]> {
    return this.discoverRefsForService("git-upload-pack").pipe(map((discovery) => discovery.refs));
  }

  /**
   * Discovers refs advertised by the remote for `git-receive-pack`.
   *
   * Performs a `GET /info/refs?service=git-receive-pack` request and parses the
   * pkt-line ref advertisement.
   */
  discoverReceiveRefs(): Observable<readonly DiscoveredRef[]> {
    return this.discoverRefsForService("git-receive-pack").pipe(map((discovery) => discovery.refs));
  }

  /**
   * Fetches objects reachable from `wants` that are not in `haves`.
   *
   * Sends a `POST /git-upload-pack` request advertising `side-band-64k` so the
   * server can report errors and stream the packfile reliably. The returned
   * objects are decoded from the packfile and stored by the caller.
   */
  fetch(wants: readonly Oid[], haves: readonly Oid[]): Observable<readonly GitObject[]> {
    const url = `${this.baseUrl}/git-upload-pack`;
    const body = SmartHttpTransport.buildFetchRequest(wants, haves, "side-band-64k ofs-delta");

    return from(
      this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-git-upload-pack-request",
          Accept: "application/x-git-upload-pack-result",
          ...this.headers,
        },
        body,
      }),
    ).pipe(
      concatMap((response) => {
        if (!response.ok) {
          return throwError(() => new Error(`Fetch failed: ${response.status} ${response.statusText}`));
        }
        return from(response.arrayBuffer());
      }),
      map((buffer) => parseFetchResponse(new Uint8Array(buffer))),
      concatMap((packfile) => from(parsePackfile(packfile, this.hashAlgorithm))),
    );
  }

  /**
   * Pushes update commands and the objects required by those updates.
   *
   * Builds a packfile from `objects`, sends a `POST /git-receive-pack` request,
   * and parses the server's report-status to determine which refs were accepted.
   */
  push(commands: readonly PushCommand[], objects: readonly GitObject[]): Observable<PushReport> {
    const url = `${this.baseUrl}/git-receive-pack`;
    const packfile = buildPackfile(objects);
    const body = SmartHttpTransport.buildPushRequest(commands, packfile);

    return from(
      this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-git-receive-pack-request",
          Accept: "application/x-git-receive-pack-result",
          ...this.headers,
        },
        body,
      }),
    ).pipe(
      concatMap((response) => {
        if (!response.ok) {
          return throwError(() => new Error(`Push failed: ${response.status} ${response.statusText}`));
        }
        return from(response.arrayBuffer());
      }),
      map((buffer) => parsePushReport(new Uint8Array(buffer), commands)),
    );
  }

  /**
   * Discovers refs advertised by the remote for the given service.
   *
   * Performs a `GET /info/refs?service=<service>` request and parses the
   * pkt-line ref advertisement.
   */
  private discoverRefsForService(
    service: "git-upload-pack" | "git-receive-pack",
  ): Observable<RefDiscovery> {
    const url = `${this.baseUrl}/info/refs?service=${service}`;
    return from(
      this.fetchImpl(url, {
        headers: {
          Accept: `application/x-${service}-advertisement`,
          ...this.headers,
        },
      }),
    ).pipe(
      concatMap((response) => {
        if (!response.ok) {
          return throwError(
            () => new Error(`Ref discovery failed: ${response.status} ${response.statusText}`),
          );
        }
        return from(response.arrayBuffer());
      }),
      map((buffer) => parseRefDiscovery(new Uint8Array(buffer), service)),
    );
  }

  /**
   * Builds the request body for a fetch negotiation.
   *
   * Sends `want <oid>` lines for each wanted ref, followed by `have <oid>`
   * lines for commits already present locally, terminated with a flush packet.
   * Capabilities are advertised on the first `want` line.
   */
  static buildFetchRequest(
    wants: readonly string[],
    haves: readonly string[],
    capabilities = "side-band-64k",
  ): Uint8Array {
    const lines: string[] = [];
    wants.forEach((want, index) => {
      lines.push(index === 0 ? `want ${want} ${capabilities}` : `want ${want}`);
    });
    haves.forEach((have) => lines.push(`have ${have}`));
    lines.push("done");
    return encodePktLines(lines);
  }

  /**
   * Builds the request body for a push.
   *
   * Sends update commands as `<old-oid> <new-oid> <ref>` lines, followed by a
   * flush packet and then the packfile bytes.
   */
  static buildPushRequest(
    commands: readonly { readonly ref: string; readonly oldOid: string; readonly newOid: string }[],
    packfile: Uint8Array,
  ): Uint8Array {
    const commandLines = commands.map(({ oldOid, newOid, ref }) => `${oldOid} ${newOid} ${ref}`);
    const header = encodePktLines(commandLines);
    const result = new Uint8Array(header.length + packfile.length);
    result.set(header);
    result.set(packfile, header.length);
    return result;
  }
}

/**
 * Parses a Smart HTTP ref advertisement response.
 *
 * Validates the service announcement, extracts advertised refs, and parses
 * the capability list attached to the first ref line.
 */
export const parseRefDiscovery = (
  data: Uint8Array,
  expectedService: "git-upload-pack" | "git-receive-pack",
): RefDiscovery => {
  const { lines } = decodePktLines(data);

  if (lines.length === 0) {
    throw new Error("Empty ref advertisement");
  }

  const serviceLine = lines[0]!;
  if (!serviceLine.startsWith(`# service=${expectedService}`)) {
    throw new Error(`Unexpected service line: ${serviceLine}`);
  }

  const refs: DiscoveredRef[] = [];
  let capabilities: string[] = [];

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index]!;
    const spaceIndex = line.indexOf(" ");
    if (spaceIndex === -1) continue;

    const oid = line.slice(0, spaceIndex) as Oid;
    const rest = line.slice(spaceIndex + 1);

    if (index === 1) {
      const nullIndex = rest.indexOf("\0");
      if (nullIndex !== -1) {
        capabilities = rest.slice(nullIndex + 1).split(" ");
        refs.push({ name: rest.slice(0, nullIndex), oid });
      } else {
        refs.push({ name: rest, oid });
      }
    } else {
      refs.push({ name: rest, oid });
    }
  }

  return { service: expectedService, refs, capabilities };
};

/**
 * Extracts the packfile bytes from a fetch response.
 *
 * The response may be a raw packfile or a side-band-64k pkt-line stream.
 * Control frames (NAK/ACK) and progress messages are skipped; error frames are
 * thrown.
 */
const parseFetchResponse = (data: Uint8Array): Uint8Array => {
  if (data.length >= 4 && new TextDecoder().decode(data.slice(0, 4)) === "PACK") {
    return data;
  }

  const { frames } = decodePktLineFrames(data);
  const packChunks: Uint8Array[] = [];

  for (const frame of frames) {
    if (frame.length === 0) continue;
    const channel = frame[0]!;
    const payload = frame.slice(1);

    if (channel === 0x01) {
      const text = new TextDecoder().decode(payload).trimEnd();
      if (text === "NAK" || text.startsWith("ACK ")) {
        continue;
      }
      packChunks.push(payload);
    } else if (channel === 0x02) {
      // Progress message; ignore for now. Could be surfaced via a logger later.
    } else if (channel === 0x03) {
      throw new Error(`Remote error: ${new TextDecoder().decode(payload).trimEnd()}`);
    } else {
      throw new Error(`Unknown side-band channel: ${channel}`);
    }
  }

  return packChunks.reduce(
    (acc, chunk) => {
      const result = new Uint8Array(acc.length + chunk.length);
      result.set(acc);
      result.set(chunk, acc.length);
      return result;
    },
    new Uint8Array(0),
  );
};

/**
 * Parses a push report-status response into a {@link PushReport}.
 *
 * The first line is `unpack ok` or `unpack <msg>`. Subsequent lines are either
 * `ok <ref>` or `ng <ref> <msg>`. If unpacking failed, every ref is marked as
 * rejected.
 */
const parsePushReport = (
  data: Uint8Array,
  commands: readonly PushCommand[],
): PushReport => {
  const { lines } = decodePktLines(data);
  let unpackOk = false;
  let unpackMessage: string | undefined;
  const refStatus = new Map<string, { readonly accepted: boolean; readonly message?: string }>();

  for (const line of lines) {
    if (line === "unpack ok") {
      unpackOk = true;
    } else if (line.startsWith("unpack ")) {
      unpackMessage = line.slice("unpack ".length);
    } else if (line.startsWith("ok ")) {
      const ref = line.slice("ok ".length);
      refStatus.set(ref, { accepted: true });
    } else if (line.startsWith("ng ")) {
      const rest = line.slice("ng ".length);
      const spaceIndex = rest.indexOf(" ");
      const ref = spaceIndex === -1 ? rest : rest.slice(0, spaceIndex);
      const message = spaceIndex === -1 ? undefined : rest.slice(spaceIndex + 1);
      refStatus.set(ref, { accepted: false, message });
    }
  }

  const accepted = commands.map(({ ref, newOid }) => {
    const status = refStatus.get(ref);
    const ok = unpackOk && status !== undefined && status.accepted;
    return { ref, oid: newOid, accepted: ok };
  });

  if (!unpackOk && unpackMessage !== undefined) {
    // Surface the unpack failure so callers do not silently think push succeeded.
    return { accepted: accepted.map((entry) => ({ ...entry, accepted: false })) };
  }

  return { accepted };
};
