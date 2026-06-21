import type { IndexEntry } from "@slim-git/types";

export class Index {
  private constructor(private readonly entries: ReadonlyMap<string, IndexEntry>) {}

  static empty(): Index {
    return new Index(new Map());
  }

  static from(entries: readonly IndexEntry[]): Index {
    const map = new Map(entries.map((entry) => [entry.path, entry]));
    return new Index(map);
  }

  get paths(): string[] {
    return Array.from(this.entries.keys()).sort();
  }

  get(path: string): IndexEntry | undefined {
    return this.entries.get(path);
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  add(entry: IndexEntry): Index {
    const next = new Map(this.entries);
    next.set(entry.path, entry);
    return new Index(next);
  }

  remove(path: string): Index {
    const next = new Map(this.entries);
    next.delete(path);
    return new Index(next);
  }

  removeMany(paths: readonly string[]): Index {
    const toRemove = new Set(paths);
    const next = new Map(Array.from(this.entries).filter(([path]) => !toRemove.has(path)));
    return new Index(next);
  }

  toArray(): IndexEntry[] {
    return this.paths
      .map((path) => this.entries.get(path))
      .filter((entry): entry is IndexEntry => entry !== undefined);
  }
}
