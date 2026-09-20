'use client';

import { createBrowserClient } from '@supabase/ssr';
import { parsePublicEnv } from '@scimem/core';

let client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Singleton browser Supabase client.
 *
 * IMPORTANT (Next.js rule): on the client, NEXT_PUBLIC_* vars only exist where
 * the bundler statically inlined them. Next replaces DIRECT member expressions
 * like `process.env.NEXT_PUBLIC_X` — but *not* a whole `process.env` object read
 * (which is what publicEnv() does; browsers don't have one). So we read the two
 * vars as static expressions HERE in app source, and hand the object to
 * parsePublicEnv so zod validation is still enforced.
 */
export function browserSupabase() {
  if (!client) {
    const env = parsePublicEnv({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
    client = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  }
  return client;
}