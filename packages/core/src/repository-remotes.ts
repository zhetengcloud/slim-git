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
import type { Remote } from "@slim-git/types";
import type { Config } from "./config.js";

/** Adds a remote repository. */
export const addRemote = (config: Config, name: string, url: string): Observable<Remote> =>
  config.set("remote", `${name}.url`, url).pipe(map(() => ({ name, url })));

/** Result of removing a remote. */
export interface RemoveRemoteResult {
  readonly removed: number;
}

/** Removes a remote repository and its configuration. */
export const removeRemote = (config: Config, name: string): Observable<RemoveRemoteResult> =>
  config.list("remote").pipe(
    concatMap((entries) => {
      const keys = entries.filter(([key]) => key.startsWith(`${name}.`)).map(([key]) => key);
      return forkJoin(keys.map((key) => config.remove("remote", key))).pipe(
        defaultIfEmpty([]),
        map(() => ({ removed: keys.length })),
      );
    }),
  );

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

/** Lists all configured remotes in the order returned by the config store. */
export const listRemotes = (config: Config): Observable<Remote[]> =>
  config.list("remote").pipe(
    concatMap((entries) => from(entries)),
    concatMap((entry) => extractRemoteUrlEntry(entry)),
    reduce(updateRemoteGroup, {} as Record<string, RemoteUrlGroup>),
    concatMap((groups) => from(Object.entries(groups))),
    concatMap(([name, group]) =>
      group.url === undefined ? [] : [{ name, url: group.url, pushUrl: group.pushUrl }],
    ),
    toArray(),
  );
