import type { Config } from "@slim-git/core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { catchError, concatMap, of, from, map, throwError, type Observable } from "rxjs";

/**
 * A parsed config entry.
 *
 * The key is stored in the dotted form used by the `Config` interface
 * (e.g. `origin.url`), not the Git file format.
 */
interface ConfigEntry {
  readonly section: string;
  readonly key: string;
  readonly value: string;
}

/** Checks whether an unknown value is a Node.js ENOENT error. */
const isNodeNotFoundError = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";

/**
 * Node.js filesystem implementation of `Config` backed by a Git config file.
 *
 * Supports the subset of Git config used by slim-git: flat sections and quoted
 * subsections such as `[remote "origin"]`. The file is loaded on first access
 * and rewritten after each mutation.
 */
export class NodeConfig implements Config {
  private entries: ConfigEntry[] = [];
  private loaded = false;

  constructor(private readonly path: string) {}

  get(section: string, key: string): Observable<string | undefined> {
    return this.load().pipe(
      map(
        () => this.entries.find((entry) => entry.section === section && entry.key === key)?.value,
      ),
    );
  }

  set(section: string, key: string, value: string): Observable<void> {
    return this.load().pipe(
      map(() => {
        const index = this.entries.findIndex(
          (entry) => entry.section === section && entry.key === key,
        );
        if (index === -1) {
          this.entries = [...this.entries, { section, key, value }];
        } else {
          this.entries = this.entries.map((entry, i) =>
            i === index ? { section, key, value } : entry,
          );
        }
      }),
      concatMap(() => this.save()),
    );
  }

  remove(section: string, key: string): Observable<void> {
    return this.load().pipe(
      map(() => {
        this.entries = this.entries.filter(
          (entry) => !(entry.section === section && entry.key === key),
        );
      }),
      concatMap(() => this.save()),
    );
  }

  list(section: string): Observable<readonly [string, string][]> {
    return this.load().pipe(
      map(() =>
        this.entries
          .filter((entry) => entry.section === section)
          .map((entry): [string, string] => [entry.key, entry.value])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ),
    );
  }

  /** Loads the config file if it hasn't been loaded yet. */
  private load(): Observable<void> {
    if (this.loaded) return of(undefined);
    return from(readFile(this.path, "utf-8")).pipe(
      map((text) => {
        this.entries = parseConfig(text);
        this.loaded = true;
      }),
      catchError((error) => {
        if (isNodeNotFoundError(error)) {
          this.entries = [];
          this.loaded = true;
          return of(undefined);
        }
        return throwError(() => error);
      }),
    );
  }

  /** Writes the current entries back to the config file. */
  private save(): Observable<void> {
    return from(mkdir(dirname(this.path), { recursive: true })).pipe(
      concatMap(() => from(writeFile(this.path, serializeConfig(this.entries)))),
    );
  }
}

/** Parses a Git config file into flat Config entries. */
const parseConfig = (text: string): ConfigEntry[] => {
  const entries: ConfigEntry[] = [];
  let currentSection: string | undefined;
  let currentSubsection: string | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (line.length === 0) continue;

    const sectionMatch = line.match(/^\[(\w+)(?:\s+"([^"]+)")?\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      currentSubsection = sectionMatch[2];
      continue;
    }

    const valueMatch = line.match(/^(\w+)\s*=\s*(.*)$/);
    if (valueMatch && currentSection !== undefined) {
      const key = valueMatch[1]!;
      const value = unquote(valueMatch[2]!.trim());
      const dottedKey = currentSubsection ? `${currentSubsection}.${key}` : key;
      entries.push({ section: currentSection, key: dottedKey, value });
    }
  }

  return entries;
};

/** Removes inline comments from a config line. */
const stripComment = (line: string): string => {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuote = !inQuote;
    } else if (!inQuote && (char === "#" || char === ";")) {
      return line.slice(0, i);
    }
  }
  return line;
};

/** Strips matching outer quotes from a value. */
const unquote = (value: string): string => {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
};

/** Serializes flat Config entries into a Git config file. */
const serializeConfig = (entries: ConfigEntry[]): string => {
  const groups = groupEntries(entries);
  const lines: string[] = [];

  for (const [section, subsections] of groups) {
    if (subsections.has("")) {
      lines.push(`[${section}]`);
      for (const [key, value] of subsections.get("")!) {
        lines.push(`\t${key} = ${quoteIfNeeded(value)}`);
      }
    }

    for (const [subsection, keys] of subsections) {
      if (subsection === "") continue;
      lines.push(`[${section} "${subsection}"]`);
      for (const [key, value] of keys) {
        lines.push(`\t${key} = ${quoteIfNeeded(value)}`);
      }
    }
  }

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
};

/** Groups entries by section, then by subsection, preserving input order. */
const groupEntries = (entries: ConfigEntry[]): Map<string, Map<string, [string, string][]>> => {
  const groups = new Map<string, Map<string, [string, string][]>>();

  for (const { section, key, value } of entries) {
    const dotIndex = key.indexOf(".");
    const subsection = dotIndex === -1 ? "" : key.slice(0, dotIndex);
    const property = dotIndex === -1 ? key : key.slice(dotIndex + 1);

    if (!groups.has(section)) groups.set(section, new Map());
    const subsections = groups.get(section)!;
    if (!subsections.has(subsection)) subsections.set(subsection, []);
    subsections.get(subsection)!.push([property, value]);
  }

  return groups;
};

/** Quotes a value if it contains whitespace or special characters. */
const quoteIfNeeded = (value: string): string => {
  if (value === "" || /\s|[#;]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
};
