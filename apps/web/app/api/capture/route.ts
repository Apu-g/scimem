import { NextRequest, NextResponse } from 'next/server';
import { embed, toVectorLiteral } from '@scimem/ai';
import { authedClient } from '@/lib/supabase/auth';
import { defaultProject, estTokens, sha256Hex, splitChunks } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

/**
 * POST /api/capture  { content, title? }
 * Embed the text, store one event + its chunks, deduped by content_hash.
 */
export async function POST(req: NextRequest) {
  let body: { content?: string; title?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const content = (body?.content ?? '').trim();
  if (!content) {
    return NextResponse.json({ error: 'content required' }, { status: 400 });
  }

  const { supabase, user } = await authedClient(req);
  if (!supabase || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const started = Date.now();
  try {
    const project = await defaultProject(supabase, user.id);
    if (!project) return NextResponse.json({ error: 'failed to create project' }, { status: 500 });

    const hash = await sha256Hex(content);
    const { data: existing } = await supabase
      .from('events')
      .select('id')
      .eq('project_id', project.id)
      .eq('content_hash', hash)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        event_id: existing.id,
        latency_ms: Date.now() - started,
      });
    }

    const parts = splitChunks(content);
    const emb = await embed({ texts: parts, inputType: 'passage' });

    const { data: evt, error: evtErr } = await supabase
      .from('events')
      .insert({
        project_id: project.id,
        user_id: user.id,
        source_type: 'note',
        platform: 'manual',
        title: (body.title ?? content.slice(0, 60)).slice(0, 120),
        content,
        content_hash: hash,
        metadata: { prototype: true, source: 'playground' },
      })
      .select('id')
      .single();
    if (evtErr || !evt) {
      return NextResponse.json({ error: `event insert failed: ${evtErr?.message}` }, { status: 500 });
    }

    const rows = parts.map((p, i) => ({
      event_id: evt.id,
      project_id: project.id,
      chunk_index: i,
      content: p,
      token_count: estTokens(p),
      embedding: toVectorLiteral(emb.vectors[i] as number[]),
    }));
    const { error: chunkErr } = await supabase.from('chunks').insert(rows);
    if (chunkErr) {
      return NextResponse.json({ error: `chunk insert failed: ${chunkErr.message}` }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      event_id: evt.id,
      chunks: rows.length,
      dim: emb.dim,
      model: emb.model,
      latency_ms: Date.now() - started,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}