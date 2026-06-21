import type { Oid } from '@slim-git/types';
import { describe, expect, test } from 'bun:test';
import { Sha1Hash, Sha256Hash } from './hash.js';

describe('Sha1Hash', () => {
  test('matches canonical Git blob hash', () => {
    const content = new TextEncoder().encode('hello\n');
    const object = Sha1Hash.hashObject('blob', content);

    expect(object.oid).toBe('ce013625030ba8dba906f756967f9e9ca394464a' as Oid);
  });

  test('produces different oids for different content', () => {
    const a = Sha1Hash.hashObject('blob', new TextEncoder().encode('a'));
    const b = Sha1Hash.hashObject('blob', new TextEncoder().encode('b'));

    expect(a.oid).not.toBe(b.oid);
  });

  test('produces different oids for different types with same content', () => {
    const content = new TextEncoder().encode('same');
    const blob = Sha1Hash.hashObject('blob', content);
    const tree = Sha1Hash.hashObject('tree', content);

    expect(blob.oid).not.toBe(tree.oid);
  });
});

describe('Sha256Hash', () => {
  test('produces a stable 64-character oid', () => {
    const content = new TextEncoder().encode('hello\n');
    const object = Sha256Hash.hashObject('blob', content);

    expect(object.oid).toHaveLength(64);
    expect(object.oid).toBe(Sha256Hash.hashObject('blob', content).oid);
  });

  test('produces different oids than sha1 for the same input', () => {
    const content = new TextEncoder().encode('hello\n');
    const sha1 = Sha1Hash.hashObject('blob', content);
    const sha256 = Sha256Hash.hashObject('blob', content);

    expect(sha1.oid).not.toBe(sha256.oid);
  });
});
