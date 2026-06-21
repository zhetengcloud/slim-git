import { concatMap, from, map, type Observable, throwError } from "rxjs";
import { decodePktLines, encodePktLines } from "./pkt-line.js";

/** A Git ref advertised by a remote server. */
export interface DiscoveredRef {
  readonly name: string;
  readonly oid: string;
}

/** Result of the initial ref discovery exchange. */
export interface RefDiscovery {
  readonly service: "git-upload-pack" | "git-receive-pack";
  readonly refs: readonly DiscoveredRef[];
  readonly capabilities: readonly string[];
}

/**
 * Smart HTTP transport for Git.
 *
 * Currently supports ref discovery. Fetch/push pack exchange will be added
 * once packfile parsing and building are in place.
 */
export class SmartHttpTransport {
  constructor(private readonly baseUrl: string) {}

  /**
   * Discovers refs advertised by the remote for the given service.
   *
   * Performs a `GET /info/refs?service=<service>` request and parses the
   * pkt-line ref advertisement.
   */
  discoverRefs(service: "git-upload-pack" | "git-receive-pack"): Observable<RefDiscovery> {
    const url = `${this.baseUrl}/info/refs?service=${service}`;
    return from(
      fetch(url, {
        headers: {
          Accept: `application/x-${service}-advertisement`,
        },
      }),
    ).pipe(
      concatMap((response) => {
        if (!response.ok) {
          return throwError(() => new Error(`Ref discovery failed: ${response.status}`));
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
   */
  static buildFetchRequest(wants: readonly string[], haves: readonly string[]): Uint8Array {
    const lines = [
      `command=fetch`,
      ...wants.map((oid) => `want ${oid}`),
      ...haves.map((oid) => `have ${oid}`),
      "done",
    ];
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

    const oid = line.slice(0, spaceIndex);
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
