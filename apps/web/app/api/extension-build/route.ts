import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { extensionBuildStatus } from '@/lib/extension-build';

export const dynamic = 'force-dynamic';

const BUILD_TIMEOUT_MS = 120_000;

/**
 * POST /api/extension-build — rebuild the MV3 extension on demand.
 *
 * The download route serves `.output` as-is, so a source change without a build
 * silently ships old code. This makes "rebuild then download" one click instead
 * of a terminal the user has to know about.
 *
 * Local-dev convenience only: it shells out to pnpm, which no serverless runtime
 * allows, and it refuses to run when deployed. Next binds *:3000, so the dev
 * server is reachable from the LAN — hence the localhost-only guard, since this
 * spawns a process and there is no session check on it.
 */
export async function POST(req: NextRequest) {
  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: 'rebuilding is a local-dev action — build the extension in CI before deploying' },
      { status: 400 },
    );
  }
  const hostname = (req.headers.get('host') ?? '').split(':')[0];
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]') {
    return NextResponse.json({ error: 'rebuild is only available from localhost' }, { status: 403 });
  }

  const repoRoot = join(process.cwd(), '..');
  const started = Date.now();

  const code = await new Promise<number>((resolve) => {
    const child = spawn('pnpm', ['--filter', '@scimem/extension', 'build'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (d) => (output += String(d)));
    child.stderr?.on('data', (d) => (output += String(d)));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(-1);
    }, BUILD_TIMEOUT_MS);
    child.on('close', (c) => {
      clearTimeout(timer);
      resolve(c ?? -1);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(-1);
    });
  });

  const status = extensionBuildStatus();
  if (code !== 0) {
    return NextResponse.json(
      { error: `build failed (exit ${code})`, status },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, status, build_ms: Date.now() - started });
}

/** GET — the same status the download route reports in its headers. */
export async function GET() {
  return NextResponse.json(extensionBuildStatus());
}
