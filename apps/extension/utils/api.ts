import { browser } from 'wxt/browser';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_API_BASE, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import type { StoredSession } from './types';

const SESSION_KEY = 'scimem_session_v1';
export const LAST_PROJECT_KEY = 'scimem_project_name';
export const API_BASE_KEY = 'scimem_api_base';

export async function getStored<T>(key: string): Promise<T | undefined> {
  const obj = await browser.storage.local.get(key);
  return obj[key] as T | undefined;
}

export async function setStored(key: string, value: unknown): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export async function clearSession(): Promise<void> {
  await browser.storage.local.remove(SESSION_KEY);
}

export async function getApiBase(): Promise<string> {
  return (await getStored<string>(API_BASE_KEY)) ?? DEFAULT_API_BASE;
}

/** Expiry of a JWT access token in ms, or null when it cannot be read. */
export function tokenExpiresAt(token: string | undefined | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Treat a token as stale a minute early so an in-flight call cannot expire mid-request. */
export function isExpiring(token: string | undefined | null, skewMs = 60_000): boolean {
  const exp = tokenExpiresAt(token);
  return exp === null ? false : exp - Date.now() <= skewMs;
}

/**
 * Exchange the stored refresh token for a fresh access token.
 *
 * Without this the panel locks itself out roughly an hour after sign-in: the
 * access token was stored on its own, it expired, and every capture came back
 * 401 with no way forward except typing the password again.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const stored = await getStored<StoredSession>(SESSION_KEY);
  if (!stored?.refresh_token) return null;
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: stored.refresh_token,
    });
    if (error || !data.session) return null;
    const next: StoredSession = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      ...(data.session.user.email ?? stored.email ? { email: data.session.user.email ?? stored.email } : {}),
    };
    await setStored(SESSION_KEY, next);
    return next.access_token;
  } catch {
    return null;
  }
}

/**
 * JSON helper for the SCIMEM API (Bearer-token auth, cross-origin via middleware).
 *
 * Token freshness lives here rather than at each call site so capture, ask,
 * trace, analyze and context-export all get it for free: an expired token is
 * refreshed before sending, and a 401 triggers exactly one refresh + retry
 * (which covers a token revoked server-side while the panel was open).
 */
export async function apiCall<T>(
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {},
): Promise<T> {
  const base = await getApiBase();
  const send = async (token?: string): Promise<Response> => {
    const init: RequestInit = {
      method: opts.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    return fetch(`${base}${path}`, init);
  };

  let token = opts.token;
  if (!token) {
    token = (await getStored<StoredSession>(SESSION_KEY))?.access_token;
    if (isExpiring(token)) token = (await refreshAccessToken()) ?? token;
  }

  let res = await send(token);
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (json.error as string) ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('session expired — sign in again');
    throw new Error(message);
  }
  return json as T;
}

/** Same auth/refresh rules as apiCall, but for the markdown endpoints. */
export async function apiCallText(path: string): Promise<string> {
  const base = await getApiBase();
  const send = async (token?: string): Promise<Response> => {
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    return fetch(`${base}${path}`, { headers });
  };

  let token = (await getStored<StoredSession>(SESSION_KEY))?.access_token;
  if (isExpiring(token)) token = (await refreshAccessToken()) ?? token;

  let res = await send(token);
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await send(fresh);
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error('session expired — sign in again');
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.text();
}