import type { Oid, TreeEntry } from "@slim-git/types";
import type { ObjectStore } from "./object-store.js";

/** Splits a file path into its directory segments. */
const splitPath = (path: string): string[] => path.split("/").filter(Boolean);

/**
 * Serializes tree entries into Git's tree object format.
 * Entries are sorted by name, then encoded as `<mode> <name>\0<20-byte oid>`.
 */
const buildTreeBytes = (entries: TreeEntry[]): Uint8Array => {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = entries
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const nameBytes = encoder.encode(`${entry.mode.toString(8)} ${entry.name}\0`);
      const oidBytes = hexToBytes(entry.oid);
      const combined = new Uint8Array(nameBytes.length + oidBytes.length);
      combined.set(nameBytes);
      combined.set(oidBytes, nameBytes.length);
      return combined;
    });

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

/** Converts a lowercase hex oid string into raw bytes. */
const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

/** Recursive tree structure used while building nested trees from flat paths. */
interface TreeNode {
  readonly entries: TreeEntry[];
  readonly children: Map<string, TreeNode>;
}

/** Creates an empty tree node. */
const emptyNode = (): TreeNode => ({ entries: [], children: new Map() });

/**
 * Inserts a path into a tree node recursively.
 * Intermediate components become directory nodes; the final component becomes a blob entry.
 */
const insertIntoNode = (
  node: TreeNode,
  segments: readonly string[],
  entry: TreeEntry,
): TreeNode => {
  if (segments.length === 0) {
    return node;
  }

  if (segments.length === 1) {
    return {
      ...node,
      entries: [...node.entries, { ...entry, name: segments[0]! }],
    };
  }

  const first = segments[0]!;
  const rest = segments.slice(1);
  const child = node.children.get(first) ?? emptyNode();
  const nextChildren = new Map(node.children);
  nextChildren.set(first, insertIntoNode(child, rest, entry));

  return {
    ...node,
    children: nextChildren,
  };
};

/**
 * Recursively writes tree objects bottom-up.
 * Each directory node becomes a tree object; its oid is inserted into its parent.
 */
const buildNode = async (node: TreeNode, store: ObjectStore): Promise<Oid> => {
  const childEntries: TreeEntry[] = await Promise.all(
    Array.from(node.children.entries()).map(async ([name, child]) => ({
      mode: 0o040000,
      name,
      oid: await buildNode(child, store),
    })),
  );

  const allEntries = [...node.entries, ...childEntries];
  const bytes = buildTreeBytes(allEntries);
  const written = await store.write("tree", bytes);
  return written.oid;
};

/**
 * Fluent builder that turns a flat list of file paths into nested Git tree objects.
 *
 * Example:
 * ```ts
 * const rootTree = await new TreeBuilder()
 *   .insert("src/index.ts", oid, mode)
 *   .insert("README.md", oid, mode)
 *   .build(objectStore);
 * ```
 */
export class TreeBuilder {
  private root: TreeNode = emptyNode();

  /** Inserts a file path into the tree structure. */
  insert(path: string, oid: Oid, mode: number): TreeBuilder {
    const segments = splitPath(path);
    if (segments.length === 0) {
      return this;
    }
    const entry: TreeEntry = { mode, name: segments[segments.length - 1]!, oid };
    this.root = insertIntoNode(this.root, segments, entry);
    return this;
  }

  /** Writes all tree objects and returns the oid of the root tree. */
  async build(store: ObjectStore): Promise<Oid> {
    return buildNode(this.root, store);
  }
}
