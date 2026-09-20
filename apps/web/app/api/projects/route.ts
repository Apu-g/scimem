import { NextRequest, NextResponse } from 'next/server';
import { authedClient } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

/** GET /api/projects — the user's projects (id, name), newest last. */
export async function GET(req: NextRequest) {
  const { supabase, user } = await authedClient(req);
  if (!supabase || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data ?? [] });
}