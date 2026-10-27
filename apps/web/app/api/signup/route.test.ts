import { describe, expect, it } from 'vitest';
import { validateSignup } from './validate';

/**
 * The failure that motivated /api/signup was Supabase's "Confirm email" toggle,
 * which no local test can reproduce. These cover the parts that are ours: input
 * validation, and the contract that makes signup succeed regardless of that
 * setting (email_confirm: true, service role, existing-user tolerated).
 */
describe('validateSignup', () => {
  it('accepts and normalises a valid email', () => {
    const r = validateSignup({ email: '  User@Example.COM ', password: 'longenough1' });
    expect(r).toEqual({ email: 'user@example.com', password: 'longenough1' });
  });

  it.each([
    ['missing', {}],
    ['not an email', { email: 'nope', password: 'longenough1' }],
    ['no domain dot', { email: 'a@b', password: 'longenough1' }],
    ['no password', { email: 'a@b.co' }],
    ['short password', { email: 'a@b.co', password: 'short' }],
    ['non-string fields', { email: 42, password: {} }],
  ])('rejects %s', (_label, body) => {
    expect(validateSignup(body)).toHaveProperty('error');
  });

  it('survives null and undefined bodies', () => {
    expect(validateSignup(null)).toHaveProperty('error');
    expect(validateSignup(undefined)).toHaveProperty('error');
  });
});
