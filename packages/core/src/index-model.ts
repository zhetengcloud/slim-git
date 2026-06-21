import type { IndexEntry } from "@slim-git/types";

/**
 * Immutable in-memory representation of the Git index (staging area).
 *
 * Every mutating operation returns a new `Index` instance, preserving the original.
 * This keeps staging logic predictable and easy to test.
 */
export class Index {
  private constructor(private readonly entries: ReadonlyMap<string, IndexEntry>) {}

  /** Creates an empty index. */
  static empty(): Index {
    return new Index(new Map());
  }

  /** Creates an index from an array of entries, keyed by path. */
  static from(entries: readonly IndexEntry[]): Index {
    const map = new Map(entries.map((entry) => [entry.path, entry]));
    return new Index(map);
  }

  /** Sorted list of all staged paths. */
  get paths(): string[] {
    return Array.from(this.entries.keys()).sort();
  }

  /** Returns the entry for a path, or undefined if the path is not staged. */
  get(path: string): IndexEntry | undefined {
    return this.entries.get(path);
  }

  /** True if the path is currently staged. */
  has(path: string): boolean {
    return this.entries.has(path);
  }

  /** Returns a new index with the given entry added or updated. */
  add(entry: IndexEntry): Index {
    const next = new Map(this.entries);
    next.set(entry.path, entry);
    return new Index(next);
  }

  /** Returns a new index with the given path removed. */
  remove(path: string): Index {
    const next = new Map(this.entries);
    next.delete(path);
    return new Index(next);
  }

  /** Returns a new index with the given paths removed. */
  removeMany(paths: readonly string[]): Index {
    const toRemove = new Set(paths);
    const next = new Map(Array.from(this.entries).filter(([path]) => !toRemove.has(path)));
    return new Index(next);
  }

  /** Returns all entries sorted by path. */
  toArray(): IndexEntry[] {
    return this.paths
      .map((path) => this.entries.get(path))
      .filter((entry): entry is IndexEntry => entry !== undefined);
  }
}
