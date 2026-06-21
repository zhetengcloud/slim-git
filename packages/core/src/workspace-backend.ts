import type { WorkspaceRemoveResult, WorkspaceWriteResult } from "@slim-git/types";
import type { Observable } from "rxjs";

/**
 * Pluggable abstraction over the repository working tree.
 *
 * Implementations may target the real filesystem, an in-memory map, or any other
 * file-like storage. This keeps repository operations decoupled from Node.js fs APIs.
 */
export interface WorkspaceBackend {
  readonly name: string;
  readFile(path: string): Observable<Uint8Array>;
  writeFile(path: string, content: Uint8Array): Observable<WorkspaceWriteResult>;
  removeFile(path: string): Observable<WorkspaceRemoveResult>;
  listFiles(): Observable<string[]>;
  exists(path: string): Observable<boolean>;
}
