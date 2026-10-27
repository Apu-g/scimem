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

/**
 * DELETE /api/projects?projectId=…  (or ?name=…)
 *
 * Deletes one project. Everything hanging off it goes with it, because the
 * schema cascades: events → chunks, plus research_pages, knowledge_items,
 * provenance_links, queries and jobs. There is no soft-delete here — if you want
 * the context back, re-capture it. The UI asks for confirmation first and shows
 * the counts.
 */
export async function DELETE(req: NextRequest) {
  const { supabase, user } = await authedClient(req);
  if (!supabase || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get('projectId')?.trim();
  const name = req.nextUrl.searchParams.get('name')?.trim();
  if (!projectId && !name) {
    return NextResponse.json({ error: 'projectId or name required' }, { status: 400 });
  }

  // RLS scopes this to the caller's own rows, so a foreign id simply is not found.
  let query = supabase.from('projects').select('id, name');
  query = projectId ? query.eq('id', projectId) : query.eq('name', name!);
  const { data: project, error: findErr } = await query.maybeSingle();
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 });

  // Report what is about to go, so the caller can log/confirm precisely.
  const [events, chunks] = await Promise.all([
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('project_id', project.id),
    supabase.from('chunks').select('id', { count: 'exact', head: true }).eq('project_id', project.id),
  ]);

  const { error } = await supabase.from('projects').delete().eq('id', project.id);
  if (error) return NextResponse.json({ error: `delete failed: ${error.message}` }, { status: 500 });

  return NextResponse.json({
    ok: true,
    deleted: { id: project.id, name: project.name ?? null },
    cascaded: { events: events.count ?? 0, chunks: chunks.count ?? 0 },
  });
}
