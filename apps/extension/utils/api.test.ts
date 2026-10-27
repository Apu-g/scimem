import { describe, expect, it } from 'vitest';
import { isExpiring, tokenExpiresAt } from './api';

/**
 * The panel stores its access token in chrome.storage and sends it as a Bearer.
 * Supabase access tokens expire after ~1h, and a stored token with no refresh
 * meant every capture came back 401 with no way forward — so expiry detection is
 * the difference between "sign in again" and "it just works".
 */

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.signature`;
}

describe('tokenExpiresAt', () => {
  it('reads exp out of a JWT', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(tokenExpiresAt(jwt({ exp }))).toBe(exp * 1000);
  });

  it('returns null for anything that is not a readable JWT', () => {
    expect(tokenExpiresAt(undefined)).toBeNull();
    expect(tokenExpiresAt(null)).toBeNull();
    expect(tokenExpiresAt('')).toBeNull();
    expect(tokenExpiresAt('not-a-jwt')).toBeNull();
    expect(tokenExpiresAt('a.b.c')).toBeNull();
    expect(tokenExpiresAt(jwt({ sub: 'no-exp' }))).toBeNull();
  });

  it('survives a payload that is not JSON', () => {
    const bad = `header.${Buffer.from('not json').toString('base64url')}.sig`;
    expect(tokenExpiresAt(bad)).toBeNull();
  });
});

describe('isExpiring', () => {
  it('is false for a token with plenty of life left', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    expect(isExpiring(jwt({ exp }))).toBe(false);
  });

  it('is true once the token is inside the skew window', () => {
    const exp = Math.floor(Date.now() / 1000) + 30; // 30s left, 60s skew
    expect(isExpiring(jwt({ exp }))).toBe(true);
  });

  it('is true for an already-expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    expect(isExpiring(jwt({ exp }))).toBe(true);
  });

  it('respects a custom skew', () => {
    const exp = Math.floor(Date.now() / 1000) + 90;
    expect(isExpiring(jwt({ exp }), 60_000)).toBe(false);
    expect(isExpiring(jwt({ exp }), 300_000)).toBe(true);
  });

  it('treats an unreadable token as not expiring, so we still try the call', () => {
    expect(isExpiring(undefined)).toBe(false);
    expect(isExpiring('garbage')).toBe(false);
  });
});
