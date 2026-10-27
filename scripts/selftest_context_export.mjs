// Dashboard feature E2E against the LOCAL dev server. Verifies the three
// routes added with the dashboard work:
//   1. GET /api/stats            → totals + per-project breakdown + feeds
//   2. GET /api/context-export   → markdown attachment per project
//   3. GET /api/extension-download → valid zip containing manifest.json
// Plus the auth guards on each (401 with no token, 404 on unknown project).
// Usage: node scripts/selftest_context_export.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.SCIMEM_WEB_URL ?? 'http://localhost:3000';
const envFile = readFileSync('apps/web/.env.local', 'utf8');
const env = Object.fromEntries(
  envFile.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).trim()];
  }),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

// wait for dev server
for (let i = 0; i < 20; i++) {
  try {
    const r = await fetch(`${BASE}/`);
    if (r.ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const supabase = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
const demoEmail = env.SCIMEM_DEMO_EMAIL;
const demoPassword = env.SCIMEM_DEMO_PASSWORD;
if (!demoEmail || !demoPassword) {
  throw new Error('SCIMEM_DEMO_EMAIL / SCIMEM_DEMO_PASSWORD not set in apps/web/.env.local');
}
const { data, error } = await supabase.auth.signInWithPassword({
  email: demoEmail,
  password: demoPassword,
});
if (error) throw new Error(`sign-in failed: ${error.message}`);
const token = data.session.access_token;
console.log(`signed in as ${demoEmail}\n`);

async function get(path, withAuth = true) {
  const res = await fetch(`${BASE}${path}`, {
    headers: withAuth ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, res };
}

// ---------------------------------------------------------------- auth guards
for (const path of ['/api/stats', '/api/context-export']) {
  const { status } = await get(path, false);
  check(`401 without token  ${path}`, status === 401, `got ${status}`);
}

// --------------------------------------------------------------------- stats
{
  const { status, res } = await get('/api/stats');
  const body = await res.json().catch(() => null);
  const ok = status === 200 && body && typeof body.totals?.projects === 'number';
  check('200 /api/stats', ok, ok ? JSON.stringify(body.totals) : `got ${status} ${JSON.stringify(body)}`);
  if (ok) {
    check(
      'stats totals.chunks matches real chunk count',
      typeof body.totals.chunks === 'number' && body.totals.chunks > 0,
      `chunks=${body.totals.chunks}`,
    );
    check('stats per-project rows', Array.isArray(body.projects) && body.projects.length === body.totals.projects);
    check('stats feeds are arrays', Array.isArray(body.captures) && Array.isArray(body.asks));
  }
}

// ----------------------------------------------------------- context export
{
  const { res } = await get('/api/projects');
  const { projects = [] } = await res.json();
  console.log(`\nprojects: ${projects.map((p) => p.name).join(', ') || '(none)'}`);
  check('at least one project to export', projects.length > 0);

  let anyExported = false;
  for (const p of projects) {
    const { status, res } = await get(`/api/context-export?projectName=${encodeURIComponent(p.name)}`);
    const body = await res.text();
    // a source with no URL legitimately has no **URL:** line, so only the header,
    // a real body and the markdown content-type are required
    const ok =
      status === 200 &&
      body.startsWith('# SCIMEM context') &&
      body.includes('## 1.') &&
      (res.headers.get('content-type') ?? '').includes('text/markdown');
    if (ok) anyExported = true;
    const usesName = body.includes(`"${p.name}"`);
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  export ${p.name} — [${status}] ${body.length} bytes` +
        `${usesName ? '' : ' (HEADER USES A UUID, NOT THE NAME)'}` +
        (status !== 200 ? ` ${body.slice(0, 120)}` : ''),
    );
    if (!ok) failures++;
    if (ok && !usesName) failures++;
  }
  check('exported at least one non-empty markdown context file', anyExported);

  const { status } = await get('/api/context-export?projectName=definitely-not-a-project-xyz');
  check('404 on unknown project', status === 404, `got ${status}`);
}

// ------------------------------------------------------- extension download
// Unauthenticated by design — a signed-out visitor must still be able to get it.
{
  const anon = await fetch(`${BASE}/api/extension-download`);
  check('200 /api/extension-download without a session', anon.status === 200, `got ${anon.status}`);

  const { status, res } = await get('/api/extension-download');
  const buf = Buffer.from(await res.arrayBuffer());
  const okHead = status === 200 && buf.length > 0 && buf.readUInt32LE(0) === 0x04034b50;
  check(
    '200 /api/extension-download with valid local-file header',
    okHead,
    `[${status}] ${buf.length} bytes, sig=0x${buf.readUInt32LE(0).toString(16)}`,
  );
  if (okHead) {
    const tmp = '/tmp/opencode/scimem-extension.zip';
    writeFileSync(tmp, buf);
    // python's zipfile is the oracle: testzip() verifies every entry's CRC, and
    // reading a member proves the local-header offsets actually resolve.
    let probe;
    try {
      probe = JSON.parse(
        execFileSync(
          'python3',
          [
            '-c',
            'import sys, json, zipfile\n' +
              'z = zipfile.ZipFile(sys.argv[1])\n' +
              'print(json.dumps({"bad": z.testzip(), "names": z.namelist(),\n' +
              '  "mv": json.loads(z.read("manifest.json"))["manifest_version"]}))\n',
            tmp,
          ],
          { encoding: 'utf8' },
        ),
      );
    } catch (e) {
      probe = { bad: `probe failed: ${e.message}`, names: [] };
    }
    check('zip contains manifest.json', probe.names.includes('manifest.json'), probe.names.join(', '));
    check('zip is MV3', probe.mv === 3, `manifest_version=${probe.mv}`);
    check('every entry CRC verifies (crc32 + offsets)', probe.bad === null, String(probe.bad));
  }
}

// ------------------------------------------------------------------- signup
{
  const probeEmail = `signup-probe-${Date.now()}@scimem.dev`;
  const probePw = 'ScimemProbe!2026';
  const post = (body) =>
    fetch(`${BASE}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  check('400 on a short password', (await post({ email: probeEmail, password: 'x' })).status === 400);
  check('400 on a bad email', (await post({ email: 'nope', password: probePw })).status === 400);

  const created = await post({ email: probeEmail, password: probePw });
  const createdBody = await created.json().catch(() => ({}));
  check('200 signing up a new account', created.status === 200, JSON.stringify(createdBody));

  // The point of the route: the new account can sign in immediately, with no
  // inbox click, even if the project has email confirmation switched on.
  const signIn = await supabase.auth.signInWithPassword({ email: probeEmail, password: probePw });
  check('new account can sign in straight away', !signIn.error, signIn.error?.message);

  const again = await post({ email: probeEmail, password: probePw });
  check('re-signing-up an existing account is not an error', again.status === 200);
}

console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
