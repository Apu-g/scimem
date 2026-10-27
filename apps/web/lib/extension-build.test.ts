import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extensionBuildStatus } from './extension-build';

/**
 * The staleness signal is what stops "I downloaded the zip and it was the old
 * version" — the download route serves `.output` verbatim, so a green build is
 * the only evidence the code in the zip matches the code on disk.
 *
 * mtimes are set explicitly: the comparison is the whole logic here.
 */

function fixture(sourceTimes: number[], outputTimes: number[]): { source: string; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'build-status-'));
  const source = join(root, 'entrypoints');
  const output = join(root, 'output');
  mkdirSync(source);
  mkdirSync(output);

  sourceTimes.forEach((t, i) => {
    const f = join(source, `f${i}.tsx`);
    writeFileSync(f, 'x');
    utimesSync(f, t / 1000, t / 1000);
  });
  outputTimes.forEach((t, i) => {
    const f = join(output, `f${i}.js`);
    writeFileSync(f, 'x');
    utimesSync(f, t / 1000, t / 1000);
  });
  return { source, output };
}

const T0 = 1_700_000_000_000;
const MIN = 60_000;

describe('extensionBuildStatus', () => {
  it('is fresh when the build is newer than every source file', () => {
    const s = extensionBuildStatus(fixture([T0, T0 + MIN], [T0 + 2 * MIN]));
    expect(s.built).toBe(true);
    expect(s.stale).toBe(false);
    expect(s.detail).toMatch(/built/);
  });

  it('is stale as soon as ANY source file is newer than the build', () => {
    const s = extensionBuildStatus(fixture([T0, T0 + 5 * MIN], [T0 + 2 * MIN]));
    expect(s.stale).toBe(true);
    expect(s.detail).toMatch(/source changed/i);
    expect(s.sourceChangedAt).not.toBeNull();
  });

  it('reports an unbuilt extension rather than throwing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'build-empty-'));
    const s = extensionBuildStatus({ source: join(empty, 'nope'), output: join(empty, 'also-nope') });
    expect(s.built).toBe(false);
    expect(s.stale).toBe(true);
    expect(s.builtAt).toBeNull();
    expect(s.detail).toMatch(/not built/i);
  });

  it('treats equal mtimes as fresh', () => {
    const s = extensionBuildStatus(fixture([T0], [T0]));
    expect(s.stale).toBe(false);
  });

  it('ignores files that are not source or build output', () => {
    const root = mkdtempSync(join(tmpdir(), 'build-noise-'));
    const source = join(root, 'entrypoints');
    const output = join(root, 'output');
    mkdirSync(source);
    mkdirSync(output);
    const old = new Date(T0);
    for (const [dir, name] of [
      [source, 'a.tsx'],
      [source, 'notes.md'],
      [output, 'b.js'],
      [output, 'logo.png'],
    ] as const) {
      const f = join(dir, name);
      writeFileSync(f, 'x');
      utimesSync(f, old, old);
    }
    // a .md/.png is neither source nor bundle, so it must not make the build stale
    const s = extensionBuildStatus({ source, output });
    expect(s.stale).toBe(false);
  });
});
