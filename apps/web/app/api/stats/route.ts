import { NextRequest, NextResponse } from 'next/server';
import { authedClient } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

interface ProjectStats {
  id: string;
  name: string;
  created_at: string;
  events: number;
  chunks: number;
  snapshots: number;
  screenshots: number;
  queries: number;
  last_event_at: string | null;
}

/**
 * GET /api/stats
 * Dashboard "monitoring department" feed — everything the web console renders,
 * all in creation order straight from the DB:
 *   totals  – projects / contexts / snapshots / screenshots / questions
 *   projects – per-project breakdown (events, chunks, snapshots, screenshots, asks)
 *   captures – most recent 12 captured sources (platform + chars)
 *   asks     – most recent 12 questions asked (client, latency, tokens)
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await authedClient(req);
  if (!supabase || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [projectsRes, eventsRes, asksRes, chunksRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, created_at')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('events')
      .select('id, project_id, source_type, platform, url, title, metadata, captured_at')
      .order('captured_at', { ascending: true }),
    supabase
      .from('queries')
      .select('id, project_id, client, question, latency_ms, tokens_raw, tokens_compiled, created_at')
      .order('created_at', { ascending: true }),
    // project_id only — the dashboard wants a count per project, not the vectors
    supabase.from('chunks').select('project_id'),
  ]);

  if (projectsRes.error) {
    return NextResponse.json({ error: `projects load failed: ${projectsRes.error.message}` }, { status: 500 });
  }
  if (eventsRes.error) {
    return NextResponse.json({ error: `events load failed: ${eventsRes.error.message}` }, { status: 500 });
  }
  if (asksRes.error) {
    return NextResponse.json({ error: `queries load failed: ${asksRes.error.message}` }, { status: 500 });
  }
  if (chunksRes.error) {
    return NextResponse.json({ error: `chunks load failed: ${chunksRes.error.message}` }, { status: 500 });
  }

  const projects = (projectsRes.data ?? []) as { id: string; name: string; created_at: string }[];
  const events = (eventsRes.data ?? []) as Array<{
    id: string;
    project_id: string;
    source_type: string | null;
    platform?: string | null;
    url: string | null;
    title: string | null;
    metadata?: { snapshot_path?: string | null; screenshot_path?: string | null; platform?: string | null } | null;
    captured_at: string;
  }>;
  const asks = (asksRes.data ?? []) as unknown as Array<{
    id: string;
    project_id: string;
    client: string | null;
    question: string;
    latency_ms: number | null;
    tokens_raw: number | null;
    tokens_compiled: number | null;
    created_at: string;
  }>;

  const byId = new Map<string, ProjectStats>(
    projects.map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        created_at: p.created_at,
        events: 0,
        chunks: 0,
        snapshots: 0,
        screenshots: 0,
        queries: 0,
        last_event_at: null,
      },
    ]),
  );

  const chunkRows = (chunksRes.data ?? []) as Array<{ project_id: string }>;

  for (const c of chunkRows) {
    const row = byId.get(c.project_id);
    if (row) row.chunks += 1;
  }
  for (const e of events) {
    const row = byId.get(e.project_id);
    if (!row) continue;
    row.events += 1;
    if (e.metadata?.snapshot_path) row.snapshots += 1;
    if (e.metadata?.screenshot_path) row.screenshots += 1;
    if (!row.last_event_at || e.captured_at > row.last_event_at) row.last_event_at = e.captured_at;
  }
  for (const q of asks) {
    const row = byId.get(q.project_id);
    if (row) row.queries += 1;
  }

  const totals = {
    projects: projects.length,
    events: events.length,
    chunks: chunkRows.length,
    snapshots: events.reduce((n, e) => n + (e.metadata?.snapshot_path ? 1 : 0), 0),
    screenshots: events.reduce((n, e) => n + (e.metadata?.screenshot_path ? 1 : 0), 0),
    queries: asks.length,
  };

  const captures = [...events]
    .sort((a, b) => b.captured_at.localeCompare(a.captured_at))
    .slice(0, 12)
    .map((e) => ({
      id: e.id,
      project: byId.get(e.project_id)?.name ?? '?',
      platform: (e.metadata as { platform?: string | null } | null)?.platform ?? e.platform ?? 'web',
      url: e.url,
      title: e.title ?? '',
      captured_at: e.captured_at,
    }));

  const asksList = [...asks]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 12)
    .map((q) => ({
      id: q.id,
      project: byId.get(q.project_id)?.name ?? '?',
      client: q.client ?? 'web',
      question: q.question,
      latency_ms: q.latency_ms,
      tokens_in: q.tokens_raw,
      tokens_out: q.tokens_compiled,
      created_at: q.created_at,
    }));

  return NextResponse.json({ totals, projects: [...byId.values()], captures, asks: asksList });
}