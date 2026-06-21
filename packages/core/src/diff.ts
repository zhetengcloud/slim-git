import type { DiffLine, Hunk } from "@slim-git/types";

/** Edit operation produced by the Myers diff algorithm. */
export interface Edit {
  readonly type: "equal" | "insert" | "delete";
  readonly oldIndex: number;
  readonly newIndex: number;
}

/** Edit script for the case where every new line is an insertion. */
const allInserts = (newLines: readonly string[]): Edit[] =>
  newLines.map((_, newIndex) => ({
    type: "insert" as const,
    oldIndex: -1,
    newIndex,
  }));

/** Edit script for the case where every old line is a deletion. */
const allDeletes = (oldLines: readonly string[]): Edit[] =>
  oldLines.map((_, oldIndex) => ({
    type: "delete" as const,
    oldIndex,
    newIndex: -1,
  }));

// --- Myers diff internals ---------------------------------------------------
//
// Myers' algorithm searches for the shortest edit script by exploring edit
// distances d = 0, 1, 2, ... . On each diagonal k = oldIndex - newIndex it
// stores the furthest oldIndex (x) reachable with d edits.
//
// Because k can be negative, the working array `v` is offset so that index
// `k + maxDistance` holds the value for diagonal k.

const createDiagonalArray = (maxDistance: number): number[] =>
  Array.from({ length: 2 * maxDistance + 1 }, () => 0);

const getFurthestX = (v: readonly number[], maxDistance: number, k: number): number =>
  v[k + maxDistance]!;

const setFurthestX = (v: number[], maxDistance: number, k: number, x: number): void => {
  v[k + maxDistance] = x;
};

/**
 * Chooses which diagonal led to the current one.
 * At the edges (`k === -d` or `k === d`) only one predecessor is valid.
 * Otherwise we prefer the predecessor that reached farther in old-index space.
 */
const choosePreviousDiagonal = (
  v: readonly number[],
  maxDistance: number,
  d: number,
  k: number,
): number => {
  if (k === -d) return k + 1;
  if (k === d) return k - 1;
  return getFurthestX(v, maxDistance, k - 1) < getFurthestX(v, maxDistance, k + 1)
    ? k + 1
    : k - 1;
};

/**
 * Walks through consecutive matching lines starting at `(oldIndex, newIndex)`
 * and returns the position where the match ends.
 */
const walkMatches = (
  oldLines: readonly string[],
  newLines: readonly string[],
  oldIndex: number,
  newIndex: number,
): { oldIndex: number; newIndex: number } => {
  let x = oldIndex;
  let y = newIndex;
  while (x < oldLines.length && y < newLines.length && oldLines[x] === newLines[y]) {
    x++;
    y++;
  }
  return { oldIndex: x, newIndex: y };
};

/** Snapshot of every diagonal's furthest x for a given edit distance `d`. */
type Trace = readonly number[][];

/**
 * Forward pass of Myers' algorithm.
 * Returns the trace (snapshots of `v` for each `d`) and the edit distance at
 * which the bottom-right corner was reached.
 */
const buildForwardTrace = (
  oldLines: readonly string[],
  newLines: readonly string[],
  maxDistance: number,
): { trace: Trace; finalDistance: number } => {
  const v = createDiagonalArray(maxDistance);
  const trace: number[][] = [];

  for (let d = 0; d <= maxDistance; d++) {
    trace.push([...v]);

    for (let k = -d; k <= d; k += 2) {
      const previousK = choosePreviousDiagonal(v, maxDistance, d, k);
      let x = getFurthestX(v, maxDistance, previousK);

      // A predecessor from k - 1 means a horizontal step (deletion) in old.
      // A predecessor from k + 1 means a vertical step (insertion) in new.
      if (previousK === k - 1) {
        x++;
      }

      const y = x - k;
      const end = walkMatches(oldLines, newLines, x, y);
      setFurthestX(v, maxDistance, k, end.oldIndex);

      if (end.oldIndex >= oldLines.length && end.newIndex >= newLines.length) {
        return { trace, finalDistance: d };
      }
    }
  }

  return { trace, finalDistance: maxDistance };
};

/**
 * Backward pass of Myers' algorithm.
 * Walks the trace from the bottom-right corner back to the origin, emitting
 * one insert/delete per diagonal jump and one equal edit per matched line.
 */
const reconstructEdits = (
  trace: Trace,
  oldLines: readonly string[],
  newLines: readonly string[],
  maxDistance: number,
  finalDistance: number,
): Edit[] => {
  const edits: Edit[] = [];
  let oldIndex = oldLines.length;
  let newIndex = newLines.length;

  for (let d = finalDistance; d >= 0; d--) {
    const previousV = trace[d];
    if (previousV === undefined) {
      continue;
    }

    const k = oldIndex - newIndex;
    const previousK = choosePreviousDiagonal(previousV, maxDistance, d, k);
    const previousX = getFurthestX(previousV, maxDistance, previousK);
    const previousY = previousX - previousK;

    // Emit the matched lines on this diagonal in reverse order.
    while (oldIndex > previousX && newIndex > previousY) {
      edits.push({
        type: "equal" as const,
        oldIndex: oldIndex - 1,
        newIndex: newIndex - 1,
      });
      oldIndex--;
      newIndex--;
    }

    // Distance 0 is the origin; there is no preceding edit to emit.
    if (d === 0) {
      break;
    }

    // Emit the single edit that moved from the previous diagonal to this one.
    if (previousK === k - 1) {
      edits.push({
        type: "delete" as const,
        oldIndex: oldIndex - 1,
        newIndex: -1,
      });
      oldIndex--;
    } else {
      edits.push({
        type: "insert" as const,
        oldIndex: -1,
        newIndex: newIndex - 1,
      });
      newIndex--;
    }
  }

  return edits.reverse();
};

/**
 * Computes the shortest edit script from `oldLines` to `newLines` using Myers'
 * O(ND) diff algorithm. The returned edits are in forward order.
 */
export const myersDiff = (oldLines: readonly string[], newLines: readonly string[]): Edit[] => {
  if (oldLines.length === 0 && newLines.length === 0) {
    return [];
  }

  if (oldLines.length === 0) {
    return allInserts(newLines);
  }

  if (newLines.length === 0) {
    return allDeletes(oldLines);
  }

  const maxDistance = oldLines.length + newLines.length;
  const { trace, finalDistance } = buildForwardTrace(oldLines, newLines, maxDistance);
  return reconstructEdits(trace, oldLines, newLines, maxDistance, finalDistance);
};

/**
 * Groups a Myers edit script into unified-diff hunks with the requested number
 * of context lines.
 */
export const createHunks = (
  edits: readonly Edit[],
  oldLines: readonly string[],
  newLines: readonly string[],
  contextLines = 3,
): Hunk[] => {
  if (edits.length === 0) {
    return [];
  }

  // Find change ranges (non-equal edits) extended by context.
  const changeRanges: { start: number; end: number }[] = [];

  for (let index = 0; index < edits.length; index++) {
    const edit = edits[index]!;
    if (edit.type === "equal") continue;

    const start = Math.max(0, index - contextLines);
    const end = Math.min(edits.length - 1, index + contextLines);

    if (changeRanges.length > 0) {
      const last = changeRanges[changeRanges.length - 1]!;
      if (start <= last.end + 1) {
        last.end = end;
        continue;
      }
    }

    changeRanges.push({ start, end });
  }

  return changeRanges.map((range) => {
    const hunkLines: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;

    // Count lines before this hunk to compute starting line numbers.
    for (let index = 0; index < range.start; index++) {
      const edit = edits[index]!;
      if (edit.type === "equal" || edit.type === "delete") {
        oldLine++;
      }
      if (edit.type === "equal" || edit.type === "insert") {
        newLine++;
      }
    }

    const oldStart = oldLine + 1;
    const newStart = newLine + 1;
    let oldLinesCount = 0;
    let newLinesCount = 0;

    for (let index = range.start; index <= range.end; index++) {
      const edit = edits[index]!;
      switch (edit.type) {
        case "equal": {
          const text = oldLines[edit.oldIndex]!;
          hunkLines.push({ type: "context", text });
          oldLinesCount++;
          newLinesCount++;
          break;
        }
        case "insert": {
          const text = newLines[edit.newIndex]!;
          hunkLines.push({ type: "added", text });
          newLinesCount++;
          break;
        }
        case "delete": {
          const text = oldLines[edit.oldIndex]!;
          hunkLines.push({ type: "removed", text });
          oldLinesCount++;
          break;
        }
      }
    }

    return {
      oldStart,
      oldLines: oldLinesCount,
      newStart,
      newLines: newLinesCount,
      lines: hunkLines,
    };
  });
};

/**
 * High-level helper: decode two byte arrays, diff them, and return unified hunks.
 */
export const unifiedDiff = (
  oldContent: Uint8Array,
  newContent: Uint8Array,
  contextLines = 3,
): Hunk[] => {
  const oldText = new TextDecoder().decode(oldContent);
  const newText = new TextDecoder().decode(newContent);
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const edits = myersDiff(oldLines, newLines);
  return createHunks(edits, oldLines, newLines, contextLines);
};

/**
 * Splits text into lines, keeping the trailing newline as part of the line if
 * present. This preserves empty final lines in diffs.
 */
const splitLines = (text: string): string[] => {
  if (text === "") {
    return [];
  }

  const lines = text.split("\n");
  for (let index = 0; index < lines.length - 1; index++) {
    lines[index] += "\n";
  }

  // If the text ended with a newline, split produces a trailing empty string.
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
};
