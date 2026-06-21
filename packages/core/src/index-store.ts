import type { IndexWriteResult } from "@slim-git/types";
import type { Observable } from "rxjs";
import type { Index } from "./index-model.js";

/**
 * Pluggable persistence for the Git index (staging area).
 * Implementations decide how and where the index is serialized.
 */
export interface IndexStore {
  read(): Observable<Index>;
  write(index: Index): Observable<IndexWriteResult>;
}
