import { NextResponse } from 'next/server';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildZip } from '@/lib/zip';
import { EXT_WEBROOT, extensionBuildStatus } from '@/lib/extension-build';

export const dynamic = 'force-dynamic';

/** Recursively collect every file under `dir` (relative paths, forward slashes). */
function collectFiles(dir: string, prefix = ''): Array<{ name: string; data: Buffer }> {
  const out: Array<{ name: string; data: Buffer }> = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...collectFiles(abs, rel));
    else out.push({ name: rel, data: readFileSync(abs) });
  }
  return out;
}

/**
 * GET /api/extension-download
 * Hands out the freshly built MV3 extension folder as a single `.zip` so you can
 * unpack it and load it at chrome://extensions (Developer mode → Load unpacked).
 * Generated on demand from the extension's own build output — no stale copy to
 * forget to refresh.
 *
 * Deliberately unauthenticated: this is a compile artifact of this repo, not
 * user data, and requiring a session made the extension unreachable for anyone
 * whose sign-up had not worked yet.
 *
 * The X-Scimem-Stale header is the important part: this serves `.output`
 * verbatim, so a source change without a rebuild would otherwise hand out old
 * code with no indication of it.
 */
export async function GET() {
  let files: Array<{ name: string; data: Buffer }>;
  try {
    files = collectFiles(EXT_WEBROOT);
  } catch {
    return NextResponse.json(
      { error: 'extension not built yet — press Rebuild on the dashboard' },
      { status: 404 },
    );
  }

  const status = extensionBuildStatus();
  const zip = buildZip(files);
  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="scimem-extension.zip"',
      'Cache-Control': 'no-store',
      'X-Scimem-Stale': String(status.stale),
      'X-Scimem-Built-At': status.builtAt ?? '',
    },
  });
}