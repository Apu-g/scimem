import { describe, expect, it } from 'vitest';
import { isNetworkError, NETWORK_HINT } from './errors';

describe('isNetworkError', () => {
  it.each([
    ['ERR_NAME_NOT_RESOLVED (DNS blocked)', new TypeError('Failed to fetch')],
    ['AuthRetryableFetchError from supabase-js', Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' })],
    ['node undici fetch failure', Object.assign(new TypeError('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND x.supabase.co') })],
    ['timeout', new Error('ETIMEDOUT')],
    ['refused', new Error('ECONNREFUSED 443')],
  ])('flags %s as a network problem', (_label, err) => {
    expect(isNetworkError(err)).toBe(true);
  });

  it.each([
    ['invalid credentials', new Error('Invalid login credentials')],
    ['user exists', new Error('User already registered')],
    ['weak password', new Error('Password should be at least 8 characters')],
    ['rate limited', new Error('Too many requests')],
  ])('does not misreport %s as a network problem', (_label, err) => {
    expect(isNetworkError(err)).toBe(false);
  });

  it('handles null and non-errors without throwing', () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
    expect(isNetworkError('fetch failed')).toBe(true);
  });

  it('tells the user it is the network, not their credentials', () => {
    expect(NETWORK_HINT).toMatch(/network/i);
    // it may say "not the credentials" — it must never ask them to check them
    expect(NETWORK_HINT).not.toMatch(/check your password|wrong password/i);
  });
});
