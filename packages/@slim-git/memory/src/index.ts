import type { GitObject, Oid, StorageBackend } from '@slim-git/core';
import { NotFoundError } from '@slim-git/core';

export class MemoryBackend implements StorageBackend {
  readonly name = 'memory';

  private readonly objects = new Map<Oid, GitObject>();

  async readObject(oid: Oid): Promise<GitObject> {
    const object = this.objects.get(oid);
    if (object === undefined) {
      throw new NotFoundError(`object ${oid}`);
    }
    return object;
  }

  async writeObject(object: GitObject): Promise<GitObject> {
    this.objects.set(object.oid, object);
    return object;
  }

  async exists(oid: Oid): Promise<boolean> {
    return this.objects.has(oid);
  }
}
