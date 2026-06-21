import type { CommitInfo, Oid, Person } from "@slim-git/types";
import type { ObjectStore } from "./object-store.js";
import { map, Observable, of, throwError } from "rxjs";
import { concatMap } from "rxjs/operators";

/**
 * Formats a timezone offset in Git's `+HHMM` / `-HHMM` notation.
 * Git stores offsets as minutes east of UTC, so a negative value becomes a positive sign.
 */
const formatTimezoneOffset = (offsetMinutes: number): string => {
  const sign = offsetMinutes <= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (absolute % 60).toString().padStart(2, "0");
  return `${sign}${hours}${minutes}`;
};

/** Serializes a person line as `Name <email> timestamp timezone`. */
const formatPerson = (label: string, person: Person): string => {
  const seconds = Math.floor(person.timestamp.getTime() / 1000);
  const offset = formatTimezoneOffset(person.timezoneOffsetMinutes);
  return `${label} ${person.name} <${person.email}> ${seconds} ${offset}`;
};

/**
 * Serializes a commit object into Git's canonical byte format:
 * tree <oid>
 * parent <oid>
 * author <person>
 * committer <person>
 *
 * <message>
 */
const buildCommitBytes = (info: Omit<CommitInfo, "oid">): Uint8Array => {
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

/**
 * Fluent builder for Git commit objects.
 *
 * Example:
 * ```ts
 * const oid = await lastValueFrom(
 *   new CommitBuilder()
 *     .tree(treeOid)
 *     .parent(parentOid)
 *     .author(person)
 *     .committer(person)
 *     .message("hello")
 *     .build(objectStore)
 * );
 * ```
 */
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

  /**
   * Serializes the commit and writes it to the object store.
   * Returns an `Observable<Oid>` so validation errors flow through the stream
   * instead of being thrown synchronously.
   */
  build(store: ObjectStore): Observable<Oid> {
    if (this.treeValue === undefined) {
      return throwError(() => new Error("CommitBuilder: tree is required"));
    }
    if (this.authorValue === undefined) {
      return throwError(() => new Error("CommitBuilder: author is required"));
    }
    if (this.committerValue === undefined) {
      return throwError(() => new Error("CommitBuilder: committer is required"));
    }

    const info: Omit<CommitInfo, "oid"> = {
      tree: this.treeValue,
      parents: this.parents,
      author: this.authorValue,
      committer: this.committerValue,
      message: this.messageValue,
    };

    const bytes = buildCommitBytes(info);
    return of(bytes).pipe(
      concatMap((content) => store.write("commit", content)),
      map((object) => object.oid),
    );
  }
}
