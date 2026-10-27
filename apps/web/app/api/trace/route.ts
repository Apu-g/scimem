import { NextRequest, NextResponse } from 'next/server';
import { authedClient } from '@/lib/supabase/auth';
import { defaultProject, findProjectByName } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

/**
 * GET /api/trace?projectName=X
 *
 * The trace view for one project: every source that was captured, in capture
 * order, with the link that makes it re-openable, plus the questions asked and
 * the retrieval decisions behind each answer. This is what the ⚡ / 🧠 cards are
 * built from — they must carry the source URLs or the pasted context in another
 * chat has no way back to the evidence.
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await authedClient(req);
  if (!supabase || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const name = req.nextUrl.searchParams.get('projectName')?.trim();
  const project = name
    ? await findProjectByName(supabase, user.id, name)
    : await defaultProject(supabase, user.id);
  if (!project) {
    return NextResponse.json({ error: name ? `project not found: "${name}"` : 'no project yet' }, { status: 404 });
  }

  const [eventsRes, chunksRes, asksRes] = await Promise.all([
    supabase
      .from('events')
      .select('id, url, title, source_type, platform, metadata, captured_at')
      .eq('project_id', project.id)
      .order('captured_at', { ascending: true }),
    supabase.from('chunks').select('id, event_id').eq('project_id', project.id),
    supabase
      .from('queries')
      .select('id, question, answer, client, latency_ms, tokens_raw, tokens_compiled, created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  for (const [name, res] of [
    ['events', eventsRes],
    ['chunks', chunksRes],
    ['queries', asksRes],
  ] as const) {
    if (res.error) {
      return NextResponse.json({ error: `${name} load failed: ${res.error.message}` }, { status: 500 });
    }
  }

  const chunks = (chunksRes.data ?? []) as Array<{ id: string; event_id: string }>;
  const chunksByEvent = new Map<string, number>();
  for (const c of chunks) chunksByEvent.set(c.event_id, (chunksByEvent.get(c.event_id) ?? 0) + 1);

  const events = (eventsRes.data ?? []) as Array<{
    id: string;
    url: string | null;
    title: string | null;
    source_type: string;
    platform: string | null;
    metadata?: Record<string, unknown> | null;
    captured_at: string;
  }>;

  const sources = events.map((e) => {
    const meta = (e.metadata ?? {}) as { platform?: string; visit_count?: number };
    return {
      id: e.id,
      title: e.title || e.url || 'Untitled source',
      url: e.url,
      platform: meta.platform ?? e.platform ?? e.source_type,
      source_type: e.source_type,
      captured_at: e.captured_at,
      chunks: chunksByEvent.get(e.id) ?? 0,
      visits: meta.visit_count ?? null,
      has_snapshot: Boolean((e.metadata as { snapshot_path?: string } | null)?.snapshot_path),
      has_screenshot: Boolean((e.metadata as { screenshot_path?: string } | null)?.screenshot_path),
    };
  });

  const asks = (asksRes.data ?? []) as Array<{
    id: string;
    question: string;
    answer: string | null;
    client: string;
    latency_ms: number | null;
    tokens_raw: number | null;
    tokens_compiled: number | null;
    created_at: string;
  }>;

  return NextResponse.json({
    project: { id: project.id, name: project.name ?? project.id },
    totals: {
      sources: sources.length,
      chunks: chunks.length,
      asks: asks.length,
      first_captured_at: sources[0]?.captured_at ?? null,
      last_captured_at: sources[sources.length - 1]?.captured_at ?? null,
    },
    sources,
    asks: asks.map((a) => ({
      id: a.id,
      question: a.question,
      answer: a.answer?.slice(0, 600) ?? null,
      client: a.client,
      latency_ms: a.latency_ms,
      tokens_in: a.tokens_raw,
      tokens_out: a.tokens_compiled,
      created_at: a.created_at,
    })),
  });
}
