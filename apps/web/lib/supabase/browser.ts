'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@scimem/core';

let client: ReturnType<typeof createBrowserClient> | null = null;

/** Singleton browser Supabase client (NEXT_PUBLIC_* vars are safe to inline). */
export function browserSupabase() {
  if (!client) {
    const env = publicEnv();
    client = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  }
  return client;
}