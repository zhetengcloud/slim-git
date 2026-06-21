import type { CommitInfo, Oid, Person } from "@slim-git/types";
import type { GitObject } from "@slim-git/types";
import { Observable, of, throwError } from "rxjs";

/**
 * Parses a person line from a commit object.
 * Format: `Name <email> <timestamp-seconds> <+/-HHMM>`
 */
const parsePersonLine = (line: string, label: string): Person => {
  const prefix = `${label} `;
  const rest = line.slice(prefix.length);

  // Email is enclosed in <...>; find the closing bracket.
  const emailStart = rest.indexOf("<");
  const emailEnd = rest.indexOf(">", emailStart);
  const name = rest.slice(0, emailStart).trim();
  const email = rest.slice(emailStart + 1, emailEnd);

  // Everything after the email is "<seconds> <offset>".
  const trailing = rest.slice(emailEnd + 1).trim();
  const [secondsText, offsetText] = trailing.split(" ");
  const timestampSeconds = Number.parseInt(secondsText!, 10);

  // Parse +HHMM / -HHMM offset into minutes.
  const sign = offsetText!.startsWith("-") ? -1 : 1;
  const hours = Number.parseInt(offsetText!.slice(1, 3), 10);
  const minutes = Number.parseInt(offsetText!.slice(3, 5), 10);
  const timezoneOffsetMinutes = sign * (hours * 60 + minutes);

  return {
    name,
    email,
    timestamp: new Date(timestampSeconds * 1000),
    timezoneOffsetMinutes,
  };
};

/**
 * Parses the canonical byte format of a commit object into an `Observable<CommitInfo>`.
 *
 * Instead of throwing synchronously, validation failures become Observable error
 * notifications that can be caught downstream with `catchError`.
 *
 * Expected format:
 * tree <oid>
 * parent <oid>
 * author <person>
 * committer <person>
 *
 * <message>
 */
export const parseCommit$ = (object: GitObject): Observable<CommitInfo> => {
  if (object.type !== "commit") {
    return throwError(() => new Error(`Expected commit object, got ${object.type}`));
  }

  const text = new TextDecoder().decode(object.content);
  const [header, ...messageParts] = text.split("\n\n");
  const lines = header!.split("\n");

  const treeLine = lines.find((line) => line.startsWith("tree "));
  const parents = lines
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice(7) as Oid);
  const authorLine = lines.find((line) => line.startsWith("author "));
  const committerLine = lines.find((line) => line.startsWith("committer "));

  if (treeLine === undefined) {
    return throwError(() => new Error("Invalid commit object: missing tree line"));
  }
  if (authorLine === undefined) {
    return throwError(() => new Error("Invalid commit object: missing author line"));
  }
  if (committerLine === undefined) {
    return throwError(() => new Error("Invalid commit object: missing committer line"));
  }

  return of({
    oid: object.oid,
    tree: treeLine.slice(5) as Oid,
    parents,
    author: parsePersonLine(authorLine, "author"),
    committer: parsePersonLine(committerLine, "committer"),
    message: messageParts.join("\n\n"),
  });
};
