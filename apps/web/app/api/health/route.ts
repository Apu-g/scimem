import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { connect } from 'node:tls';
import { publicEnv } from '@scimem/core';

export const dynamic = 'force-dynamic';

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * GET /api/health
 *
 * Answers "why can't I sign in" instead of surfacing a bare "Failed to fetch".
 * Runs the three things that can independently break auth — DNS, TLS and the
 * Supabase auth endpoint — and reports the first one that fails, because they
 * have completely different fixes (change DNS vs use a different network vs fix
 * a project setting).
 *
 * Deliberately unauthenticated: it reveals nothing but connectivity status.
 */
export async function GET() {
  const env = publicEnv();
  const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host;
  const steps: Step[] = [];
  let address: string | null = null;

  // 1. DNS
  try {
    const records = await lookup(host);
    address = records.address;
    steps.push({ name: 'dns', ok: true, detail: `${host} → ${address}` });
  } catch (e) {
    steps.push({
      name: 'dns',
      ok: false,
      detail: `${host} does not resolve: ${(e as Error).message}`,
    });
    return NextResponse.json({ ok: false, steps, verdict: DNS_VERDICT }, { status: 200 });
  }

  // 2. TLS handshake (a dropped handshake shows up as ERR_NAME_NOT_RESOLVED's
  //    sibling: TCP connects, then nothing comes back)
  const tls = await new Promise<Step>((resolve) => {
    const socket = connect(
      { host: address!, port: 443, servername: host, rejectUnauthorized: false },
      () => {
        socket.destroy();
        resolve({ name: 'tls', ok: true, detail: `handshake OK with ${address}` });
      },
    );
    socket.setTimeout(8000, () => {
      socket.destroy();
      resolve({
        name: 'tls',
        ok: false,
        detail: `connected to ${address}:443 but no TLS handshake within 8s — the connection is being dropped`,
      });
    });
    socket.on('error', (e) =>
      resolve({ name: 'tls', ok: false, detail: `${address}:443 — ${e.message}` }),
    );
  });
  steps.push(tls);
  if (!tls.ok) {
    return NextResponse.json({ ok: false, steps, verdict: TLS_VERDICT }, { status: 200 });
  }

  // 3. Auth endpoint
  try {
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      signal: AbortSignal.timeout(8000),
    });
    const ok = res.ok;
    steps.push({ name: 'supabase-auth', ok, detail: `GET /auth/v1/health → ${res.status}` });
    return NextResponse.json({
      ok,
      steps,
      verdict: ok
        ? 'Supabase is reachable — sign-in should work.'
        : `Supabase answered ${res.status} on /auth/v1/health. Check the project URL and anon key.`,
    });
  } catch (e) {
    steps.push({ name: 'supabase-auth', ok: false, detail: (e as Error).message });
    return NextResponse.json({ ok: false, steps, verdict: TLS_VERDICT }, { status: 200 });
  }
}

const DNS_VERDICT =
  'Your DNS server cannot resolve this Supabase project. Public resolvers can, so the app and your keys are fine. ' +
  'Fix: set DNS to 1.1.1.1 or 8.8.8.8 — or if that still fails, your network is blocking Supabase: use a VPN or hotspot.';

const TLS_VERDICT =
  'DNS resolves but the TLS handshake to Supabase is dropped mid-connection. That is a network-level block, not a ' +
  'config or key problem — DNS settings alone will not fix it. Use a VPN or a different network (phone hotspot).';
