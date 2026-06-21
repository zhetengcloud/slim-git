/** A single parsed .gitignore rule. */
export interface GitignorePattern {
  /** Glob or literal path to match. */
  readonly pattern: string;
  /** True if the rule starts with `!` and re-includes a path. */
  readonly negated: boolean;
  /** True if the rule ends with `/` and should only match directories. */
  readonly directoryOnly: boolean;
  /** True if the rule contains a `/` or starts with `/`, anchoring it to the .gitignore location. */
  readonly anchored: boolean;
}

/**
 * Parses the raw text of a `.gitignore` file into ordered rules.
 *
 * Ignores blank lines and `#` comments. Strips leading/trailing whitespace and
 * trailing `/` directory markers.
 */
export const parseGitignore = (content: string): readonly GitignorePattern[] => {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      const withoutPrefix = negated ? line.slice(1) : line;
      const directoryOnly = withoutPrefix.endsWith("/");
      const withoutSuffix = directoryOnly ? withoutPrefix.slice(0, -1) : withoutPrefix;
      const anchored = withoutSuffix.startsWith("/") || withoutSuffix.includes("/");
      const pattern = withoutSuffix.startsWith("/") ? withoutSuffix.slice(1) : withoutSuffix;

      return { pattern, negated, directoryOnly, anchored };
    });
};

/**
 * Determines whether a workspace path is ignored by the given ordered rules.
 *
 * Supports:
 * - `*.ext` globs against the final path component.
 * - `dir/` directory rules.
 * - `/anchored` rules and rules containing `/`.
 * - `!negated` rules that re-include previously ignored paths.
 */
export const isIgnored = (path: string, patterns: readonly GitignorePattern[]): boolean => {
  let ignored = false;

  for (const rule of patterns) {
    if (matches(path, rule)) {
      ignored = !rule.negated;
    }
  }

  return ignored;
};

const matches = (path: string, rule: GitignorePattern): boolean => {
  if (rule.anchored) {
    return matchesAnchored(path, rule.pattern, rule.directoryOnly);
  }

  return matchesUnanchored(path, rule.pattern, rule.directoryOnly);
};

const matchesAnchored = (path: string, pattern: string, directoryOnly: boolean): boolean => {
  if (directoryOnly) {
    return path === pattern || path.startsWith(`${pattern}/`);
  }

  return path === pattern;
};

const matchesUnanchored = (path: string, pattern: string, directoryOnly: boolean): boolean => {
  const parts = path.split("/");

  if (directoryOnly) {
    return parts.some((part) => part === pattern);
  }

  const regex = globToRegex(pattern);
  return parts.some((part) => regex.test(part));
};

const globToRegex = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
};
