import type { Ref } from "@slim-git/types";

export interface RefStore {
  read(ref: string): Promise<string | undefined>;
  write(ref: string, target: string): Promise<void>;
  list(prefix: string): Promise<Ref[]>;
}
