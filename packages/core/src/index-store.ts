import type { Index } from "./index-model.js";

/**
 * Pluggable persistence for the Git index (staging area).
 * Implementations decide how and where the index is serialized.
 */
export interface IndexStore {
  read(): Promise<Index>;
  write(index: Index): Promise<void>;
}
