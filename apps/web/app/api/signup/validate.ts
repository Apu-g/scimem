/**
 * Sign-up input check. Lives outside route.ts because Next.js only allows route
 * handlers and config to be exported from a route file, and this needs to be
 * importable by the test.
 */
export function validateSignup(
  body: unknown,
): { email: string; password: string } | { error: string } {
  const b = (body ?? {}) as { email?: unknown; password?: unknown };
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  const password = typeof b.password === 'string' ? b.password : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: 'a valid email is required' };
  }
  if (password.length < 8) {
    return { error: 'password must be at least 8 characters' };
  }
  return { email, password };
}
