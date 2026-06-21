import type { IndexEntry, Oid, Person, Status } from "@slim-git/types";
import type { StorageBackend } from "./backend.js";
import { CommitBuilder } from "./commit-builder.js";
import { DefaultHash, type HashAlgorithm } from "./hash.js";
import { Index } from "./index-model.js";
import type { IndexStore } from "./index-store.js";
import { ObjectStore } from "./object-store.js";
import type { RefStore } from "./ref-store.js";
import { TreeBuilder } from "./tree-builder.js";
import type { WorkspaceBackend } from "./workspace-backend.js";

export interface RepositoryOptions {
  readonly hash?: HashAlgorithm;
  readonly refs?: RefStore;
  readonly index?: IndexStore;
  readonly workspace?: WorkspaceBackend;
}

export interface CommitOptions {
  readonly message: string;
  readonly author: Person;
  readonly committer?: Person;
}

const DefaultFileMode = 0o100644;

const createIndexEntry = (path: string, oid: Oid, content: Uint8Array): IndexEntry => {
  const now = new Date();
  const timestampSeconds = Math.floor(now.getTime() / 1000);

  return {
    path,
    oid,
    mode: DefaultFileMode,
    stage: 0,
    fileSize: content.length,
    ctimeSeconds: timestampSeconds,
    ctimeNanos: 0,
    mtimeSeconds: timestampSeconds,
    mtimeNanos: 0,
    dev: 0,
    ino: 0,
    uid: 0,
    gid: 0,
    assumeValid: false,
    extended: false,
    skipWorktree: false,
    intentToAdd: false,
  };
};

interface TreeEntryMap {
  readonly oid: Oid;
  readonly mode: number;
}

const parseTreeEntries = (content: Uint8Array): Map<string, TreeEntryMap> => {
  const entries = new Map<string, TreeEntryMap>();
  const text = new TextDecoder().decode(content);
  let position = 0;

  while (position < content.length) {
    const spaceIndex = content.indexOf(0x20, position);
    const nullIndex = content.indexOf(0x00, spaceIndex + 1);
    if (spaceIndex === -1 || nullIndex === -1) break;

    const mode = Number.parseInt(text.slice(position, spaceIndex), 8);
    const name = text.slice(spaceIndex + 1, nullIndex);
    const oidStart = nullIndex + 1;
    const oidEnd = oidStart + 20;
    const oidBytes = content.slice(oidStart, oidEnd);
    const oid = Array.from(oidBytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("") as Oid;

    entries.set(name, { oid, mode });
    position = oidEnd;
  }

  return entries;
};

const findInTree = async (
  store: ObjectStore,
  treeOid: Oid,
  segments: readonly string[],
): Promise<TreeEntryMap | undefined> => {
  if (segments.length === 0) {
    return undefined;
  }

  const tree = await store.read(treeOid);
  const entries = parseTreeEntries(tree.content);
  const entry = entries.get(segments[0]!);

  if (entry === undefined) {
    return undefined;
  }

  if (segments.length === 1) {
    return entry;
  }

  return findInTree(store, entry.oid, segments.slice(1));
};

export class Repository {
  readonly objectStore: ObjectStore;
  readonly refs: RefStore;
  readonly indexStore: IndexStore;
  readonly workspace: WorkspaceBackend;

  private constructor(
    readonly backend: StorageBackend,
    readonly hashAlgorithm: HashAlgorithm,
    refs: RefStore,
    indexStore: IndexStore,
    workspace: WorkspaceBackend,
  ) {
    this.objectStore = new ObjectStore(backend, hashAlgorithm);
    this.refs = refs;
    this.indexStore = indexStore;
    this.workspace = workspace;
  }

  static async init(backend: StorageBackend, options: RepositoryOptions = {}): Promise<Repository> {
    return new Repository(
      backend,
      options.hash ?? DefaultHash,
      options.refs ?? { read: async () => undefined, write: async () => {}, list: async () => [] },
      options.index ?? { read: async () => Index.empty(), write: async () => {} },
      options.workspace ?? {
        name: "noop",
        readFile: async () => new Uint8Array(),
        writeFile: async () => {},
        removeFile: async () => {},
        listFiles: async () => [],
        exists: async () => false,
      },
    );
  }

  static async open(backend: StorageBackend, options: RepositoryOptions = {}): Promise<Repository> {
    return Repository.init(backend, options);
  }

  async status(): Promise<Status> {
    const index = await this.indexStore.read();
    const workspaceFiles = await this.workspace.listFiles();
    const headTree = await this.readHeadTree();

    const staged = await this.computeStaged(index, headTree);

    const trackedChanges = await Promise.all(
      index.paths.map(async (path) => {
        if (!(await this.workspace.exists(path))) {
          return { path, kind: "deleted" as const };
        }
        const workspaceContent = await this.workspace.readFile(path);
        const blob = this.objectStore.hashObject("blob", workspaceContent);
        return blob.oid !== index.get(path)?.oid ? { path, kind: "modified" as const } : undefined;
      }),
    );

    const modified = trackedChanges
      .filter((change) => change?.kind === "modified")
      .map((change) => change!.path);
    const deleted = trackedChanges
      .filter((change) => change?.kind === "deleted")
      .map((change) => change!.path);

    const tracked = new Set(index.paths);
    const untracked = workspaceFiles.filter((path) => !tracked.has(path));

    return { staged, modified, deleted, untracked };
  }

  private async readHeadTree(): Promise<Oid | undefined> {
    const head = await this.refs.read("HEAD");
    if (head === undefined) {
      return undefined;
    }
    const commit = await this.objectStore.read(head as Oid);
    const treeLine = new TextDecoder()
      .decode(commit.content)
      .split("\n")
      .find((line) => line.startsWith("tree "));
    return treeLine?.slice(5) as Oid | undefined;
  }

  private async computeStaged(index: Index, headTree: Oid | undefined): Promise<string[]> {
    if (headTree === undefined) {
      return index.paths;
    }

    const changes = await Promise.all(
      index.paths.map(async (path) => {
        const entry = index.get(path);
        if (entry === undefined) {
          return undefined;
        }
        const headEntry = await findInTree(
          this.objectStore,
          headTree,
          path.split("/").filter(Boolean),
        );
        return headEntry?.oid !== entry.oid ? path : undefined;
      }),
    );

    return changes.filter((path): path is string => path !== undefined);
  }

  async add(paths: readonly string[]): Promise<void> {
    const index = await this.indexStore.read();
    const next = await paths.reduce<Promise<Index>>(async (currentIndexPromise, path) => {
      const currentIndex = await currentIndexPromise;
      const content = await this.workspace.readFile(path);
      const blob = await this.objectStore.write("blob", content);
      const entry = createIndexEntry(path, blob.oid, content);
      return currentIndex.add(entry);
    }, Promise.resolve(index));
    await this.indexStore.write(next);
  }

  async remove(paths: readonly string[]): Promise<void> {
    const index = await this.indexStore.read();
    await Promise.all(paths.map((path) => this.workspace.removeFile(path)));
    await this.indexStore.write(index.removeMany(paths));
  }

  async restore(paths: readonly string[]): Promise<void> {
    const index = await this.indexStore.read();
    await Promise.all(
      paths.map(async (path) => {
        const entry = index.get(path);
        if (entry === undefined) {
          return;
        }
        const object = await this.objectStore.read(entry.oid);
        await this.workspace.writeFile(path, object.content);
      }),
    );
  }

  async commit(options: CommitOptions): Promise<Oid> {
    const index = await this.indexStore.read();
    const treeOid = await this.buildTreeFromIndex(index);
    const parent = await this.refs.read("HEAD");

    const builder = new CommitBuilder()
      .tree(treeOid)
      .author(options.author)
      .committer(options.committer ?? options.author)
      .message(options.message);

    if (parent !== undefined) {
      builder.parent(parent as Oid);
    }

    const commitOid = await builder.build(this.objectStore);
    await this.refs.write("HEAD", commitOid);
    await this.indexStore.write(Index.empty());
    return commitOid;
  }

  async amend(options: CommitOptions): Promise<Oid> {
    const headTarget = await this.refs.read("HEAD");
    if (headTarget === undefined) {
      throw new Error("Cannot amend: HEAD does not exist");
    }

    const headCommit = await this.objectStore.read(headTarget as Oid);
    const treeLine = new TextDecoder()
      .decode(headCommit.content)
      .split("\n")
      .find((line) => line.startsWith("tree "));
    const treeOid = treeLine?.slice(5) as Oid | undefined;

    if (treeOid === undefined) {
      throw new Error("Cannot amend: HEAD commit has no tree");
    }

    const parents = await this.readParents(headTarget as Oid);
    const builder = new CommitBuilder()
      .tree(treeOid)
      .parentsList(parents)
      .author(options.author)
      .committer(options.committer ?? options.author)
      .message(options.message);

    const commitOid = await builder.build(this.objectStore);
    await this.refs.write("HEAD", commitOid);
    return commitOid;
  }

  private async buildTreeFromIndex(index: Index): Promise<Oid> {
    const builder = index.toArray().reduce((tree, entry) => {
      return tree.insert(entry.path, entry.oid, entry.mode);
    }, new TreeBuilder());

    return builder.build(this.objectStore);
  }

  private async readParents(commitOid: Oid): Promise<Oid[]> {
    const object = await this.objectStore.read(commitOid);
    const text = new TextDecoder().decode(object.content);
    return text
      .split("\n")
      .filter((line) => line.startsWith("parent "))
      .map((line) => line.slice(7) as Oid);
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
