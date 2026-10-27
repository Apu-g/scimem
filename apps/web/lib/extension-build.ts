import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tells the dashboard whether the zip it is about to hand out is actually
 * current.
 *
 * This exists because the download route serves `apps/extension/.output`
 * verbatim: if the extension source changed and nobody ran the build, you get a
 * perfectly valid zip containing old code, with nothing in the response to say
 * so. That reads as "the app is broken" when the build is simply stale.
 */

export const EXT_WEBROOT = join(process.cwd(), '../extension/.output/chrome-mv3');
const EXT_SOURCE_ROOT = join(process.cwd(), '../extension/entrypoints');

function newestMtime(dir: string, exts: string[]): number {
  let newest = 0;
  const walk = (current: string) => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(current, entry);
      const stat = statSync(abs);
      if (stat.isDirectory()) walk(abs);
      else if (exts.some((e) => entry.endsWith(e))) newest = Math.max(newest, stat.mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

export interface BuildStatus {
  built: boolean;
  stale: boolean;
  builtAt: string | null;
  sourceChangedAt: string | null;
  detail: string;
}

export interface BuildRoots {
  source: string;
  output: string;
}

/**
 * Roots default to Next's cwd (apps/web) but are injectable so the staleness
 * comparison can be tested against controlled directories — cwd-derived paths
 * are only correct when the process happens to start in apps/web.
 */
export function extensionBuildStatus(roots?: Partial<BuildRoots>): BuildStatus {
  const source = roots?.source ?? EXT_SOURCE_ROOT;
  const output = roots?.output ?? EXT_WEBROOT;
  const sourceAt = newestMtime(source, ['.ts', '.tsx', '.css']);
  const outputAt = newestMtime(output, ['.js', '.json', '.html', '.css']);

  if (outputAt === 0) {
    return {
      built: false,
      stale: true,
      builtAt: null,
      sourceChangedAt: sourceAt ? new Date(sourceAt).toISOString() : null,
      detail: 'extension not built yet',
    };
  }
  const stale = sourceAt > outputAt;
  return {
    built: true,
    stale,
    builtAt: new Date(outputAt).toISOString(),
    sourceChangedAt: sourceAt ? new Date(sourceAt).toISOString() : null,
    detail: stale
      ? `source changed ${new Date(sourceAt).toLocaleString()} — after the build. Press Rebuild.`
      : `built ${new Date(outputAt).toLocaleString()}`,
  };
}
