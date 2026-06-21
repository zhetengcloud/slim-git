import type { GitObject, Oid } from "@slim-git/types";
import type { Observable } from "rxjs";

/** A ref advertised by a remote transport during discovery. */
export interface DiscoveredRef {
  readonly name: string;
  readonly oid: Oid;
}

/** A single push update command. */
export interface PushCommand {
  readonly ref: string;
  readonly oldOid: Oid;
  readonly newOid: Oid;
}

/** Result returned by a push operation. */
export interface PushReport {
  readonly accepted: readonly {
    readonly ref: string;
    readonly oid: Oid;
    readonly accepted: boolean;
  }[];
}

/**
 * Abstraction over remote repository transports.
 *
 * Implementations may use Smart HTTP, SSH, local filesystem, or in-memory
 * exchanges. The core repository logic uses this interface for fetch, push,
 * and pull operations.
 */
export interface Transport {
  readonly name: string;

  /** Discovers refs advertised by the remote for fetching. */
  discoverRefs(): Observable<readonly DiscoveredRef[]>;

  /** Discovers refs advertised by the remote for pushing. */
  discoverReceiveRefs(): Observable<readonly DiscoveredRef[]>;

  /**
   * Fetches objects reachable from `wants` that are not in `haves`.
   * Returns the fetched objects; the caller stores them locally.
   */
  fetch(wants: readonly Oid[], haves: readonly Oid[]): Observable<readonly GitObject[]>;

  /**
   * Pushes update commands and the objects required by those updates.
   * Returns a report indicating which refs were accepted.
   */
  push(commands: readonly PushCommand[], objects: readonly GitObject[]): Observable<PushReport>;
}
