import type { Observable } from "rxjs";

/**
 * Minimal Git config abstraction.
 *
 * Supports flat key lookups within a section. Subsections (e.g. `remote.origin`)
 * are encoded as dotted keys, so `get("remote", "origin.url")` reads the URL
 * for the `origin` remote.
 */
export interface Config {
  /** Reads a config value, returning undefined if absent. */
  get(section: string, key: string): Observable<string | undefined>;

  /** Writes a config value. */
  set(section: string, key: string, value: string): Observable<void>;

  /** Removes a config value. */
  remove(section: string, key: string): Observable<void>;

  /** Lists all key/value pairs in a section, sorted by key. */
  list(section: string): Observable<readonly [string, string][]>;
}
