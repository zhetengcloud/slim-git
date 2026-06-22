import type { Remote } from "@slim-git/types";
import {
  concatMap,
  defaultIfEmpty,
  forkJoin,
  from,
  map,
  reduce,
  toArray,
  type Observable,
} from "rxjs";
import type { Config } from "./config.js";

/** Result of removing a remote. */
export interface RemoveRemoteResult {
  readonly removed: number;
}

/** Remote config keys that contribute to a {@link Remote}. */
type RemoteProperty = "url" | "pushurl";

/** A single remote URL config entry. */
interface RemoteUrlEntry {
  readonly name: string;
  readonly property: RemoteProperty;
  readonly value: string;
}

/** Accumulates the URL values found for one remote name. */
interface RemoteUrlGroup {
  readonly url?: string;
  readonly pushUrl?: string;
}

/**
 * Remote configuration management.
 *
 * This service keeps remote-related logic out of the main `Repository` facade.
 */
export class RemoteService {
  constructor(private readonly config: Config) {}

  /** Adds a remote repository. */
  addRemote(name: string, url: string): Observable<Remote> {
    return this.config.set("remote", `${name}.url`, url).pipe(map(() => ({ name, url })));
  }

  /** Removes a remote repository and its configuration. */
  removeRemote(name: string): Observable<RemoveRemoteResult> {
    return this.config.list("remote").pipe(
      concatMap((entries) => {
        const keys = entries.filter(([key]) => key.startsWith(`${name}.`)).map(([key]) => key);
        return forkJoin(keys.map((key) => this.config.remove("remote", key))).pipe(
          defaultIfEmpty([]),
          map(() => ({ removed: keys.length })),
        );
      }),
    );
  }

  /** Lists all configured remotes in the order returned by the config store. */
  listRemotes(): Observable<Remote[]> {
    return this.config.list("remote").pipe(
      concatMap((entries) => from(entries)),
      concatMap((entry) => extractRemoteUrlEntry(entry)),
      reduce(updateRemoteGroup, {} as Record<string, RemoteUrlGroup>),
      concatMap((groups) => from(Object.entries(groups))),
      concatMap(([name, group]) =>
        group.url === undefined ? [] : [{ name, url: group.url, pushUrl: group.pushUrl }],
      ),
      toArray(),
    );
  }
}

/**
 * Extracts URL-related remote config entries, dropping malformed keys and
 * unrelated properties. Returns an array so callers can `flatMap` over entries
 * without introducing nullable values.
 */
const extractRemoteUrlEntry = ([key, value]: readonly [
  string,
  string,
]): readonly RemoteUrlEntry[] => {
  const dotIndex = key.indexOf(".");
  if (dotIndex === -1) return [];

  const property = key.slice(dotIndex + 1);
  if (property !== "url" && property !== "pushurl") return [];

  return [{ name: key.slice(0, dotIndex), property, value }];
};

/**
 * Updates the grouped URL values for a remote. Git config treats `url` and
 * `pushurl` as single-valued keys, so the last seen value wins.
 */
const updateRemoteGroup = (
  groups: Record<string, RemoteUrlGroup>,
  { name, property, value }: RemoteUrlEntry,
): Record<string, RemoteUrlGroup> => ({
  ...groups,
  [name]:
    property === "url" ? { ...groups[name], url: value } : { ...groups[name], pushUrl: value },
});
