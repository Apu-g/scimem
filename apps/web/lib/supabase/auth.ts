import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { publicEnv } from '@scimem/core';
import { createUserClient, type ScimemSupabase } from '@/lib/supabase/server';

export interface AuthedContext {
  supabase: ScimemSupabase;
  userId: string;
}

/**
 * Resolve the acting user for an API request.
 * - Authorization: Bearer <access_token>  -> token-bound client (future CLI/extension contract)
 * - otherwise cookie session             -> browser playground
 */
export async function authedClient(req: NextRequest): Promise<
  | { supabase: ScimemSupabase; user: { id: string } }
  | { supabase: null; user: null }
> {
  const env = publicEnv();
  const header = req.headers.get('authorization') ?? '';

  if (header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      global: {
        // all subsequent PostgREST calls run as this user; RLS applies
        headers: { Authorization: `Bearer ${token}` },
      },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return { supabase: null, user: null };
    return { supabase, user: { id: data.user.id } };
  }

  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { supabase: null, user: null };
  return { supabase, user: { id: data.user.id } };
}