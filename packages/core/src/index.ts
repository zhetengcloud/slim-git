/**
 * Public exports for `@slim-git/core`.
 *
 * This package contains the backend abstractions, object model, and repository
 * implementation. Concrete backends (memory, filesystem, SQL) live in separate packages.
 */
export * from "@slim-git/types";
export * from "./backend.js";
export * from "./commit-builder.js";
export * from "./commit-parser.js";
export * from "./config.js";
export * from "./diff.js";

export * from "./hash.js";
export * from "./index-model.js";
export * from "./index-store.js";
export * from "./object-store.js";
export * from "./ref-store.js";
export * from "./repository.js";
export * from "./repository-diff.js";
export * from "./repository-merge.js";
export * from "./repository-remotes.js";
export * from "./tree-builder.js";
export * from "./tree-utils.js";
export * from "./workspace-backend.js";
