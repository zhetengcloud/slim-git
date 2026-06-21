/**
 * Pluggable abstraction over the repository working tree.
 *
 * Implementations may target the real filesystem, an in-memory map, or any other
 * file-like storage. This keeps repository operations decoupled from Node.js fs APIs.
 */
export interface WorkspaceBackend {
  readonly name: string;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
  removeFile(path: string): Promise<void>;
  listFiles(): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}
