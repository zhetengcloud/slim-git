import type { Ref, RefDeleteResult, RefWriteResult } from "@slim-git/types";
import type { Observable } from "rxjs";

/**
 * Pluggable storage for Git refs.
 * Refs include HEAD, branches (`refs/heads/*`), tags (`refs/tags/*`), and remotes.
 */
export interface RefStore {
  read(ref: string): Observable<string | undefined>;
  write(ref: string, target: string): Observable<RefWriteResult>;
  delete(ref: string): Observable<RefDeleteResult>;
  list(prefix: string): Observable<Ref[]>;
}
