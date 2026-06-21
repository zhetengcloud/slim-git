export interface WorkspaceBackend {
  readonly name: string;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: Uint8Array): Promise<void>;
  removeFile(path: string): Promise<void>;
  listFiles(): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}
