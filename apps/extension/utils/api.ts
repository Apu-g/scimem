import { browser } from 'wxt/browser';
import { DEFAULT_API_BASE } from './config';

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

/** JSON helper for the SCIMEM API (Bearer-token auth, cross-origin via middleware). */
export async function apiCall<T>(
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; token?: string } = {},
): Promise<T> {
  const base = await getApiBase();
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(`${base}${path}`, init);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error((json.error as string) ?? `HTTP ${res.status}`);
  }
  return json as T;
}