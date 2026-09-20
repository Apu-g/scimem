import { describe, expect, it } from 'vitest';
import { parsePublicEnv, parseServerEnv, resetEnvCache } from './env.js';

/** A fully-valid server env source used across tests. */
function validServerSource(): Record<string, unknown> {
  return {
    SUPABASE_SERVICE_ROLE_KEY: 'sb-secret-role-key',
    NVIDIA_API_KEY: 'nvapi-test',
    NVIDIA_EMBED_MODEL: 'nvidia/embed-test',
    NVIDIA_EMBED_DIM: '1024',
    NVIDIA_RERANK_MODEL: 'nvidia/rerank-test',
    GROQ_API_KEY: 'gsk-test',
    GROQ_MODEL: 'groq/fast-json',
    OPENROUTER_API_KEY: 'sk-or-test',
    OPENROUTER_MODEL: 'openrouter/answer',
    APP_BASE_URL: 'http://localhost:3000',
  };
}

describe('serverEnv', () => {
  it('throws a readable error naming a missing variable', () => {
    const source = validServerSource();
    delete source.GROQ_API_KEY;
    expect(() => parseServerEnv(source)).toThrowError(/GROQ_API_KEY: missing/);
  });

  it('names every missing variable at once', () => {
    const source = validServerSource();
    delete source.NVIDIA_API_KEY;
    delete source.OPENROUTER_MODEL;
    expect(() => parseServerEnv(source)).toThrowError(/NVIDIA_API_KEY: missing/);
    expect(() => parseServerEnv(source)).toThrowError(/OPENROUTER_MODEL: missing/);
  });

  it('coerces NVIDIA_EMBED_DIM string into a positive integer', () => {
    const parsed = parseServerEnv(validServerSource());
    expect(parsed.NVIDIA_EMBED_DIM).toBe(1024);
  });

  it('rejects a malformed URL', () => {
    const source = validServerSource();
    source.APP_BASE_URL = 'not-a-url';
    expect(() => parseServerEnv(source)).toThrowError(/APP_BASE_URL/);
  });

  it('passes when every variable is present and valid', () => {
    const parsed = parseServerEnv(validServerSource());
    expect(parsed.GROQ_MODEL).toBe('groq/fast-json');
  });

  it('rejects an empty NVIDIA_EMBED_DIM as missing', () => {
    const source = validServerSource();
    source.NVIDIA_EMBED_DIM = '';
    expect(() => parseServerEnv(source)).toThrowError(/NVIDIA_EMBED_DIM: missing/);
  });
});

describe('publicEnv', () => {
  it('throws a readable error naming the missing variable', () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' })).toThrowError(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY: missing/,
    );
  });

  it('passes when both public variables are valid', () => {
    const parsed = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    });
    expect(parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-key');
  });
});

describe('resetEnvCache', () => {
  it('clears memoized values between tests', () => {
    resetEnvCache();
    expect(resetEnvCache).not.toThrow();
  });
});