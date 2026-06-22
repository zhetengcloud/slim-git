import type { CommitInfo, LogOptions } from "@slim-git/types";
import { NotFoundError } from "@slim-git/types";
import { concatMap, distinct, expand, from, type Observable, throwError } from "rxjs";
import { parseCommit$ } from "./commit-parser.js";
import type { ObjectStore } from "./object-store.js";
import { RefService } from "./ref-service.js";

/**
 * Commit history traversal.
 *
 * This service keeps history-walking logic out of the main `Repository` facade.
 */
export class HistoryService {
  constructor(
    private readonly objectStore: ObjectStore,
    private readonly refService: RefService,
  ) {}

  /**
   * Returns an Observable that emits commit history starting from HEAD or the given ref.
   *
   * The stream walks parents breadth-first, deduplicates shared ancestors, and can be
   * composed with any RxJS operators (e.g. `take(10)`).
   */
  log(options: LogOptions = {}): Observable<CommitInfo> {
    const startRef = options.ref ?? "HEAD";

    return this.resolveCommitInfo$(startRef).pipe(
      expand((commit) =>
        from(commit.parents).pipe(concatMap((parent) => this.resolveCommitInfo$(parent))),
      ),
      distinct((commit) => commit.oid),
    );
  }

  /** Resolves a ref name, branch name, or oid to a `CommitInfo`. */
  resolveCommitInfo$(ref: string): Observable<CommitInfo> {
    return this.refService.resolveRef(ref).pipe(
      concatMap((oid) => {
        if (oid === undefined) {
          return throwError(() => new NotFoundError(`ref ${ref}`));
        }
        return this.objectStore.read(oid).pipe(concatMap((object) => parseCommit$(object)));
      }),
    );
  }
}
