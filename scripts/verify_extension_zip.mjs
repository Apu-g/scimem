// Offline check of what /api/extension-download would hand the browser: zip the
// real build output with the real writer, then let python's zipfile verify every
// entry's CRC and confirm manifest.json is loadable. No Supabase needed, so this
// stays meaningful while the network to the DB is blocked.
// Usage: npx tsx scripts/verify_extension_zip.mjs
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildZip } from '../apps/web/lib/zip.ts';

const ROOT = 'apps/extension/.output/chrome-mv3';

function collect(dir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...collect(abs, rel));
    else out.push({ name: rel, data: readFileSync(abs) });
  }
  return out;
}

const files = collect(ROOT);
const zip = buildZip(files);
const out = '/tmp/opencode/scimem-extension.zip';
writeFileSync(out, zip);
console.log(`zipped ${files.length} files → ${out} (${(zip.length / 1024).toFixed(0)} KB)`);

const probe = JSON.parse(
  execFileSync(
    'python3',
    [
      '-c',
      'import sys, json, zipfile\n' +
        'z = zipfile.ZipFile(sys.argv[1])\n' +
        'print(json.dumps({"bad": z.testzip(), "names": z.namelist(),\n' +
        '  "manifest": json.loads(z.read("manifest.json"))}))\n',
      out,
    ],
    { encoding: 'utf8' },
  ),
);

let fail = 0;
const ok = (label, cond, detail = '') => {
  if (!cond) fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

ok('every entry CRC verifies', probe.bad === null, probe.bad ? `bad entry: ${probe.bad}` : '');
ok('manifest.json present at the archive root', probe.names.includes('manifest.json'));
ok('manifest is valid JSON', !!probe.manifest);
ok('manifest_version 3', probe.manifest?.manifest_version === 3, String(probe.manifest?.manifest_version));
ok('sidepanel declared', !!probe.manifest?.side_panel?.default_path, JSON.stringify(probe.manifest?.side_panel));
ok('background service worker declared', !!probe.manifest?.background?.service_worker);
ok('host permissions cover the API', JSON.stringify(probe.manifest?.host_permissions));
ok('no .map / stray files', !probe.names.some((n) => n.endsWith('.map')), probe.names.join(', '));

console.log(fail === 0 ? '\nEXTENSION ZIP OK' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
