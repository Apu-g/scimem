import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@scimem/core';
import { validateSignup } from './validate';
import { isNetworkError, NETWORK_HINT } from '@/lib/supabase/errors';

export const dynamic = 'force-dynamic';

/**
 * POST /api/signup  { email, password }
 *
 * Creates the account through the service role with email_confirm: true, so
 * signing up works whether or not the Supabase project's "Confirm email" toggle
 * is on. With the toggle on, the plain browser signUp() returns no session and
 * sign-in is refused until the inbox is clicked — a dead end for a user who just
 * wants to use the dashboard and download the extension.
 *
 * This endpoint is unauthenticated by design: anyone may already create an
 * account with the public anon key, so this adds no capability — it only skips
 * the confirmation step. Do NOT expose it on a public deployment without putting
 * rate limiting / captcha in front of it.
 */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const checked = validateSignup(raw);
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { email, password } = checked;

  const env = { ...publicEnv(), ...serverEnv() }; // public carries the URL, server the service key
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    // Already registered is not a failure here — the caller signs in next anyway.
    if (/already|registered|exists/i.test(error.message)) {
      return NextResponse.json({ ok: true, existed: true });
    }
    // Supabase unreachable is our problem, not a bad request from the caller.
    if (isNetworkError(error)) {
      return NextResponse.json({ error: NETWORK_HINT, code: 'supabase_unreachable' }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, existed: false, id: data.user?.id });
}
