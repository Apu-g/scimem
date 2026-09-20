// One-off: create the prototype demo user (email already confirmed) so the
// playground can be signed into immediately without email confirmation.
// Usage: node scripts/make_demo_user.mjs
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const envFile = readFileSync('apps/web/.env.local', 'utf8');
const env = Object.fromEntries(
  envFile.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i), l.slice(i + 1).trim()];
  }),
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) throw new Error('missing env');

const email = env.SCIMEM_DEMO_EMAIL ?? 'demo@scimem.dev';
const password = env.SCIMEM_DEMO_PASSWORD ?? 'DEMO_PASSWORD_REDACTED';

const admin = createClient(URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const dupe = existing.data?.users?.find((u) => u.email === email);
if (dupe) {
  console.log(`already exists: ${dupe.id} (${dupe.email})`);
  process.exit(0);
}
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) {
  console.error('create failed:', error.message);
  process.exit(1);
}
console.log(`created demo user: ${data.user.id} ${data.user.email}`);
console.log(`  sign in with  ${email} / ${password}`);