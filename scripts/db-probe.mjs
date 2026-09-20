// Probe Supabase DB connectivity options. Reads the DB password from keys.txt.
// Prints only host/port/outcome — never the password.
import { readFileSync } from 'node:fs';
import pg from 'pg';

const keyLine = readFileSync('keys.txt', 'utf8')
  .split('\n')
  .find((l) => l.startsWith('supabase datbasepassword'));
if (!keyLine) throw new Error('DB password not found in keys.txt');

const password = keyLine.split(' - ').slice(1).join(' - ').trim();
const REF = 'xccudezjjdtzpyojyodp';
const user = `postgres.${REF}`;

const candidates = [
  { host: `db.${REF}.supabase.co`, port: 5432, label: 'direct 5432' },
  { host: `db.${REF}.supabase.co`, port: 5432, label: 'direct 5432 ipv4only', family: 4 },
  { host: `aws-0-us-east-1.pooler.supabase.com`, port: 5432, label: 'pooler ses us-east-1' },
  { host: `aws-0-us-east-1.pooler.supabase.com`, port: 6543, label: 'pooler tx us-east-1' },
  { host: `{ref}.pooler.supabase.com`, port: 5432, label: 'pooler short 5432' },
  { host: `{ref}.pooler.supabase.com`, port: 6543, label: 'pooler short 6543' },
];

for (const c of candidates) {
  const host = c.host.replace('{ref}', REF);
  const client = new pg.Client({
    host,
    port: c.port,
    user,
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    ...(c.family ? { family: c.family } : {}),
  });
  try {
    await client.connect();
    const r = await client.query('select count(*) from pg_extension');
    console.log(`${c.label} -> OK (pg_extension rows: ${r.rows[0].count})`);
    await client.end();
    break;
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e);
    console.log(`${c.label} -> FAIL: ${msg}`);
  }
}