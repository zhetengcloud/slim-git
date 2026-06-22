import type { Config } from "@slim-git/core";
import { readFile } from "node:fs/promises";
import { catchError, concatMap, from, map, of, type Observable } from "rxjs";
import { isNodeNotFoundError, writeFileEnsuringDir$ } from "./node-utils.js";

/**
 * A parsed config entry.
 *
 * The key is stored in the dotted form used by the `Config` interface
 * (e.g. `origin.url`), not the Git file format.
 */
export interface ConfigEntry {
  readonly section: string;
  readonly key: string;
  readonly value: string;
}

/**
 * Node.js filesystem implementation of `Config` backed by a Git config file.
 *
 * Supports the subset of Git config used by slim-git: flat sections and quoted
 * subsections such as `[remote "origin"]`.
 */
export class NodeConfig implements Config {
  constructor(private readonly path: string) {}

  get(section: string, key: string): Observable<string | undefined> {
    return readConfigEntries(this.path).pipe(
      map((entries) =>
        entries.find((entry) => entry.section === section && entry.key === key),
      ),
      map((entry) => entry?.value),
    );
  }

  set(section: string, key: string, value: string): Observable<void> {
    return readConfigEntries(this.path).pipe(
      map((entries) => replaceEntry(entries, { section, key, value })),
      concatMap((entries) => writeConfigEntries(this.path, entries)),
    );
  }

  remove(section: string, key: string): Observable<void> {
    return readConfigEntries(this.path).pipe(
      map((entries) =>
        entries.filter(
          (entry) => !(entry.section === section && entry.key === key),
        ),
      ),
      concatMap((entries) => writeConfigEntries(this.path, entries)),
    );
  }

  list(section: string): Observable<readonly [string, string][]> {
    return readConfigEntries(this.path).pipe(
      map((entries) =>
        entries
          .filter((entry) => entry.section === section)
          .map((entry): [string, string] => [entry.key, entry.value])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ),
    );
  }
}

/** Reads the config file, returning an empty array if it does not exist. */
export const readConfigEntries = (path: string): Observable<readonly ConfigEntry[]> =>
  from(readFile(path, "utf-8")).pipe(
    map((text) => parseConfig(text)),
    catchError((error) => {
      if (isNodeNotFoundError(error)) {
        return of([]);
      }
      throw error;
    }),
  );

/** Returns a new entries array with the given entry inserted or updated. */
export const replaceEntry = (
  entries: readonly ConfigEntry[],
  entry: ConfigEntry,
): readonly ConfigEntry[] => {
  const index = entries.findIndex(
    (existing) =>
      existing.section === entry.section && existing.key === entry.key,
  );

  if (index === -1) {
    return [...entries, entry];
  }

  return entries.map((existing, i) => (i === index ? entry : existing));
};

/** Writes serialized config entries to the file, creating parent directories. */
export const writeConfigEntries = (
  path: string,
  entries: readonly ConfigEntry[],
): Observable<void> => writeFileEnsuringDir$(path, serializeConfig(entries));

/** Parses a Git config file into flat Config entries. */
export const parseConfig = (text: string): ConfigEntry[] => {
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
export const stripComment = (line: string): string => {
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
export const unquote = (value: string): string => {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
};

/** Serializes flat Config entries into a Git config file. */
export const serializeConfig = (entries: readonly ConfigEntry[]): string => {
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
export const groupEntries = (
  entries: readonly ConfigEntry[],
): Map<string, Map<string, [string, string][]>> => {
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
export const quoteIfNeeded = (value: string): string => {
  if (value === "" || /\s|[#;]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
};
