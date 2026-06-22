/**
 * Public exports for `@slim-git/fs`.
 *
 * Provides Node.js filesystem-backed implementations of slim-git's storage
 * abstractions: object database, refs, index, workspace, and config.
 */
export * from "./node-workspace.js";
export * from "./node-config.js";
export * from "./node-ref-store.js";
export * from "./node-storage.js";
export * from "./node-index-store.js";
export * from "./index-codec.js";
export * from "./node-repository.js";
export * from "./node-utils.js";
