import type { Oid, TreeEntry } from "@slim-git/types";
import type { ObjectStore } from "./object-store.js";

const splitPath = (path: string): string[] => path.split("/").filter(Boolean);

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

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

interface TreeNode {
  readonly entries: TreeEntry[];
  readonly children: Map<string, TreeNode>;
}

const emptyNode = (): TreeNode => ({ entries: [], children: new Map() });

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

export class TreeBuilder {
  private root: TreeNode = emptyNode();

  insert(path: string, oid: Oid, mode: number): TreeBuilder {
    const segments = splitPath(path);
    if (segments.length === 0) {
      return this;
    }
    const entry: TreeEntry = { mode, name: segments[segments.length - 1]!, oid };
    this.root = insertIntoNode(this.root, segments, entry);
    return this;
  }

  async build(store: ObjectStore): Promise<Oid> {
    return buildNode(this.root, store);
  }
}
