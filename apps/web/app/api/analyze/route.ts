import { NextRequest, NextResponse } from 'next/server';
import { chatFast } from '@scimem/ai';
import { authedClient } from '@/lib/supabase/auth';
import { defaultProject, findProjectByName } from '@/lib/pipeline';
import { buildAnalysisPrompt, toAnalysisResult, type AnalysisSource } from '@/lib/analysis';

export const dynamic = 'force-dynamic';

const MAX_SOURCES = 25;

/**
 * GET /api/analyze?projectName=X
 *
 * The compressed read of a project, used by the ⚡ card. Groq (chatFast) rather
 * than OpenRouter: this is a summarisation over bulk text where latency and cost
 * matter more than prose quality, and it is already verified at ~700ms.
 *
 * Every source line carries its URL so the analysis remains traceable after it
 * is pasted into another chat.
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

  const { data: events, error } = await supabase
    .from('events')
    .select('id, url, title, platform, source_type, metadata, captured_at, chunks(content)')
    .eq('project_id', project.id)
    .order('captured_at', { ascending: true })
    .limit(MAX_SOURCES);
  if (error) return NextResponse.json({ error: `events load failed: ${error.message}` }, { status: 500 });

  const rows = (events ?? []) as Array<{
    id: string;
    url: string | null;
    title: string | null;
    platform: string | null;
    source_type: string;
    metadata?: { platform?: string } | null;
    captured_at: string;
    chunks?: Array<{ content: string }> | null;
  }>;

  const sources: AnalysisSource[] = rows
    .map((r) => ({
      title: r.title || r.url || 'Untitled source',
      url: r.url,
      platform: r.metadata?.platform ?? r.platform ?? r.source_type,
      captured_at: r.captured_at,
      text: (r.chunks ?? []).map((c) => c.content).join('\n\n'),
    }))
    .filter((s) => s.text.trim().length > 0);

  if (sources.length === 0) {
    return NextResponse.json({ error: 'nothing captured in this project yet' }, { status: 404 });
  }

  const started = Date.now();
  const { system, user: prompt, inputChars } = buildAnalysisPrompt(sources);
  const completion = await chatFast({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    maxTokens: 900,
    temperature: 0.2,
  });

  const result = toAnalysisResult(completion.content, sources, inputChars);

  return NextResponse.json({
    ok: true,
    project: { id: project.id, name: project.name ?? project.id },
    ...result,
    model: completion.model,
    tokens: { in: completion.tokensIn, out: completion.tokensOut },
    latency_ms: Date.now() - started,
  });
}
