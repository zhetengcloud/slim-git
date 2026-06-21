import type { DiffLine, Hunk } from "@slim-git/types";

/** Internal edit operation produced by the Myers algorithm. */
interface Edit {
  readonly type: "equal" | "insert" | "delete";
  readonly oldIndex: number;
  readonly newIndex: number;
}

/**
 * Computes the shortest edit script from `oldLines` to `newLines` using Myers'
 * O(ND) diff algorithm. The returned edits are in forward order.
 */
export const myersDiff = (oldLines: readonly string[], newLines: readonly string[]): Edit[] => {
  const n = oldLines.length;
  const m = newLines.length;

  if (n === 0 && m === 0) {
    return [];
  }

  if (n === 0) {
    return newLines.map((_, index) => ({
      type: "insert" as const,
      oldIndex: -1,
      newIndex: index,
    }));
  }

  if (m === 0) {
    return oldLines.map((_, index) => ({
      type: "delete" as const,
      oldIndex: index,
      newIndex: -1,
    }));
  }

  const max = n + m;
  const v: number[] = Array.from({ length: 2 * max + 1 }, () => 0);
  const trace: number[][] = [];

  let x = 0;
  let y = 0;
  let d = 0;

  search: for (d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      if (k === -d || (k !== d && v[k - 1 + max]! < v[k + 1 + max]!)) {
        x = v[k + 1 + max]!;
      } else {
        x = v[k - 1 + max]! + 1;
      }
      y = x - k;
      while (x < n && y < m && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= n && y >= m) {
        break search;
      }
    }
  }

  const edits: Edit[] = [];
  x = n;
  y = m;

  for (; d >= 0; d--) {
    const previousV = trace[d];
    if (previousV === undefined) {
      continue;
    }
    const k = x - y;

    let previousK: number;
    if (k === -d || (k !== d && previousV[k - 1 + max]! < previousV[k + 1 + max]!)) {
      previousK = k + 1;
    } else {
      previousK = k - 1;
    }

    const previousX = previousV[previousK + max]!;
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      edits.push({
        type: "equal" as const,
        oldIndex: x - 1,
        newIndex: y - 1,
      });
      x--;
      y--;
    }

    if (d === 0) {
      break;
    }

    if (x === previousX) {
      edits.push({
        type: "insert" as const,
        oldIndex: -1,
        newIndex: y - 1,
      });
      y--;
    } else {
      edits.push({
        type: "delete" as const,
        oldIndex: x - 1,
        newIndex: -1,
      });
      x--;
    }
  }

  return edits.reverse();
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
