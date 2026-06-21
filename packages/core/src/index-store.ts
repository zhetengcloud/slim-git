import type { Index } from "./index-model.js";

export interface IndexStore {
  read(): Promise<Index>;
  write(index: Index): Promise<void>;
}
