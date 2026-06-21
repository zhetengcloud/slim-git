import { concatMap, defaultIfEmpty, forkJoin, map, type Observable } from "rxjs";
import type { Remote } from "@slim-git/types";
import type { Config } from "./config.js";

/** Adds a remote repository. */
export const addRemote = (config: Config, name: string, url: string): Observable<Remote> =>
  config.set("remote", `${name}.url`, url).pipe(map(() => ({ name, url })));

/** Removes a remote repository and its configuration. */
export const removeRemote = (config: Config, name: string): Observable<void> =>
  config.list("remote").pipe(
    concatMap((entries) =>
      forkJoin(
        entries
          .filter(([key]) => key.startsWith(`${name}.`))
          .map(([key]) => config.remove("remote", key)),
      ).pipe(defaultIfEmpty([])),
    ),
    map(() => undefined),
  );

/** Lists all configured remotes sorted by name. */
export const listRemotes = (config: Config): Observable<Remote[]> =>
  config.list("remote").pipe(
    map((entries) => {
      const urls = new Map<string, string>();
      for (const [key, value] of entries) {
        const dotIndex = key.indexOf(".");
        if (dotIndex === -1) continue;
        const name = key.slice(0, dotIndex);
        const property = key.slice(dotIndex + 1);
        if (property === "url") {
          urls.set(name, value);
        }
      }
      return Array.from(urls.entries())
        .map(([name, url]) => ({ name, url }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }),
  );
