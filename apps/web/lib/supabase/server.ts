import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { publicEnv } from '@scimem/core';

export type ScimemSupabase = ReturnType<typeof createServerClient>;

/** Cookie-session Supabase client for server components / route handlers. */
export async function createUserClient(): Promise<ScimemSupabase> {
  const env = publicEnv();
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called during a render where cookies are immutable — safe to ignore.
        }
      },
    },
  });
}