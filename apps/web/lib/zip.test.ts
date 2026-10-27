import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip } from './zip';

/**
 * The zip writer feeds /api/extension-download, which hands the file straight to
 * Chrome. A wrong CRC or offset makes the extension unloadable with no useful
 * error, so these tests validate the bytes with python's zipfile (testzip
 * verifies every entry's CRC) instead of re-implementing a reader in TS.
 */
interface ZipProbe {
  /** name of the first entry whose CRC failed, or null when all entries are good */
  bad: string | null;
  names: string[];
  /** base64 of the requested member's contents */
  data: string;
}

function probe(zip: Buffer, member?: string): ZipProbe {
  const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
  const file = join(dir, 'out.zip');
  writeFileSync(file, zip);
  const out = execFileSync(
    'python3',
    [
      '-c',
      'import sys, json, base64, zipfile\n' +
        'z = zipfile.ZipFile(sys.argv[1])\n' +
        'd = base64.b64encode(z.read(sys.argv[2])).decode() if len(sys.argv) > 2 else ""\n' +
        'print(json.dumps({"bad": z.testzip(), "names": z.namelist(), "data": d}))\n',
      file,
      ...(member ? [member] : []),
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(out) as ZipProbe;
}

const read = (p: ZipProbe): string => Buffer.from(p.data, 'base64').toString('utf8');

describe('buildZip', () => {
  it('writes a local file header first and an end-of-central-directory last', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });

  it('round-trips a small stored entry and a large deflated entry', () => {
    const large = 'compress me '.repeat(500);
    const zip = buildZip([
      { name: 'manifest.json', data: Buffer.from(JSON.stringify({ name: 'scimem' })) },
      { name: 'big.txt', data: Buffer.from(large) },
    ]);

    const all = probe(zip);
    expect(all.bad).toBeNull(); // every entry's CRC verified
    expect(all.names).toEqual(['manifest.json', 'big.txt']);
    expect(read(probe(zip, 'big.txt'))).toBe(large);
    expect(read(probe(zip, 'manifest.json'))).toBe('{"name":"scimem"}');
  });

  it('stores entries under 64 bytes uncompressed and deflates the rest', () => {
    const tiny = buildZip([{ name: 't.txt', data: Buffer.from('hi') }]);
    expect(tiny.readUInt16LE(8)).toBe(0); // method 0 = stored
    expect(tiny.readUInt32LE(22)).toBe(2);

    const big = buildZip([{ name: 'b.txt', data: Buffer.from('x'.repeat(200)) }]);
    expect(big.readUInt16LE(8)).toBe(8); // method 8 = deflate
    expect(big.readUInt32LE(22)).toBe(200); // uncompressed size
    expect(big.readUInt32LE(18)).toBeLessThan(200); // compressed size
  });

  it('preserves nested relative paths and unicode names', () => {
    const zip = buildZip([
      { name: 'nested/dir/file.js', data: Buffer.from('console.log(1)') },
      { name: 'ünïcode.txt', data: Buffer.from('ok') },
    ]);
    expect(probe(zip).bad).toBeNull();
    expect(probe(zip).names).toEqual(['nested/dir/file.js', 'ünïcode.txt']);
    expect(read(probe(zip, 'nested/dir/file.js'))).toBe('console.log(1)');
  });

  it('emits a valid empty archive', () => {
    const zip = buildZip([]);
    expect(zip.length).toBe(22);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
  });
});
