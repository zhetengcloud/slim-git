import type { Ref } from "@slim-git/types";

/**
 * Pluggable storage for Git refs.
 * Refs include HEAD, branches (`refs/heads/*`), tags (`refs/tags/*`), and remotes.
 */
export interface RefStore {
  read(ref: string): Promise<string | undefined>;
  write(ref: string, target: string): Promise<void>;
  list(prefix: string): Promise<Ref[]>;
}
