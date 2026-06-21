import type { CommitInfo, Oid, Person } from "@slim-git/types";
import type { ObjectStore } from "./object-store.js";

const formatTimezoneOffset = (offsetMinutes: number): string => {
  const sign = offsetMinutes <= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (absolute % 60).toString().padStart(2, "0");
  return `${sign}${hours}${minutes}`;
};

const formatPerson = (label: string, person: Person): string => {
  const seconds = Math.floor(person.timestamp.getTime() / 1000);
  const offset = formatTimezoneOffset(person.timezoneOffsetMinutes);
  return `${label} ${person.name} <${person.email}> ${seconds} ${offset}`;
};

const buildCommitBytes = (info: CommitInfo): Uint8Array => {
  const encoder = new TextEncoder();
  const lines: string[] = [
    `tree ${info.tree}`,
    ...info.parents.map((parent) => `parent ${parent}`),
    formatPerson("author", info.author),
    formatPerson("committer", info.committer),
    "",
    info.message,
  ];
  return encoder.encode(lines.join("\n"));
};

export class CommitBuilder {
  private parents: Oid[] = [];
  private treeValue: Oid | undefined;
  private authorValue: Person | undefined;
  private committerValue: Person | undefined;
  private messageValue = "";

  parent(oid: Oid): CommitBuilder {
    this.parents = [...this.parents, oid];
    return this;
  }

  parentsList(oids: readonly Oid[]): CommitBuilder {
    this.parents = [...oids];
    return this;
  }

  tree(oid: Oid): CommitBuilder {
    this.treeValue = oid;
    return this;
  }

  author(person: Person): CommitBuilder {
    this.authorValue = person;
    return this;
  }

  committer(person: Person): CommitBuilder {
    this.committerValue = person;
    return this;
  }

  message(text: string): CommitBuilder {
    this.messageValue = text;
    return this;
  }

  async build(store: ObjectStore): Promise<Oid> {
    if (this.treeValue === undefined) {
      throw new Error("CommitBuilder: tree is required");
    }
    if (this.authorValue === undefined) {
      throw new Error("CommitBuilder: author is required");
    }
    if (this.committerValue === undefined) {
      throw new Error("CommitBuilder: committer is required");
    }

    const info: CommitInfo = {
      tree: this.treeValue,
      parents: this.parents,
      author: this.authorValue,
      committer: this.committerValue,
      message: this.messageValue,
    };

    const bytes = buildCommitBytes(info);
    const object = await store.write("commit", bytes);
    return object.oid;
  }
}
