import { NextRequest, NextResponse } from 'next/server';
import { embed, toVectorLiteral } from '@scimem/ai';
import { authedClient } from '@/lib/supabase/auth';
import { estTokens, resolveProject, sha256Hex, splitChunks } from '@/lib/pipeline';
import { extractReadableText, detectPlatform } from '@/lib/extract';
import { decodeImageDataUrl, uploadSnapshot } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Embed chunks in batches to stay inside the model's max input. */
const EMBED_BATCH = 16;
const MAX_CHUNKS = 64;

/**
 * POST /api/capture-page  { url, title?, html?, screenshot?, projectName? }
 * Full-page capture from the extension:
 *   1. resolve (or create) the named project
 *   2. upsert research_pages by (project_id, url), bumping visit counters
 *   3. extract readable text server-side, chunk + embed it into events/chunks
 *   4. store raw HTML + screenshot snapshots in the `snapshots` bucket
 *      (paths recorded for future Playwright re-crawl / Graphiti backtracking)
 */
export async function POST(req: NextRequest) {
  let body: {
    url?: string;
    title?: string;
    html?: string;
    screenshot?: string;
    projectName?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(body?.url ?? '');
  } catch {
    return NextResponse.json({ error: 'valid url required' }, { status: 400 });
  }

  const { supabase, user } = await authedClient(req);
  if (!supabase || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const started = Date.now();
  try {
    const project = await resolveProject(supabase, user.id, body.projectName);
    if (!project) return NextResponse.json({ error: 'failed to resolve project' }, { status: 500 });

    const url = parsedUrl.href;
    const domain = parsedUrl.hostname;
    const title = (body.title ?? url).slice(0, 300);
    const nowIso = new Date().toISOString();

    const text = extractReadableText(body.html ?? '', url);
    const platform = detectPlatform(url);
    const textChars = text.length;
    if (textChars === 0) {
      return NextResponse.json({
        ok: true,
        note: 'page yielded no readable text — skipped',
        url,
        title,
        project: project.name ?? project.id,
        latency_ms: Date.now() - started,
      });
    }

    const hash = await sha256Hex(text);

    // --- research_pages lookup (unique per project+url) ---
    const { data: pageExisting } = await supabase
      .from('research_pages')
      .select('id, visit_count, snapshot_path')
      .eq('project_id', project.id)
      .eq('url', url)
      .limit(1)
      .maybeSingle();

    // --- dedupe by extracted content within this project (unconditional) ---
    // Same knowledge captured at a different URL is still one event per
    // (project, content_hash). The research_pages row is still recorded/bumped
    // (visit tracking), but storage writes + embedding are skipped on a dup.
    const { data: existing } = await supabase
      .from('events').select('id')
      .eq('project_id', project.id)
      .eq('content_hash', hash)
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (pageExisting) {
        const nextVisits = (pageExisting.visit_count ?? 1) + 1;
        await supabase
          .from('research_pages')
          .update({ visit_count: nextVisits, last_seen: nowIso, last_checked_at: nowIso })
          .eq('id', pageExisting.id);
      } else {
        await supabase.from('research_pages').insert({
          project_id: project.id,
          user_id: user.id,
          url,
          domain,
          title,
          snippet: text.slice(0, 180),
          visit_count: 1,
          content_hash: hash,
          last_checked_at: nowIso,
        });
      }
      return NextResponse.json({
        ok: true,
        duplicate: true,
        event_id: existing.id,
        page_id: pageExisting?.id ?? null,
        url,
        title,
        text_chars: textChars,
        snapshot_path: pageExisting?.snapshot_path ?? null,
        screenshot_path: null,
        project: project.name ?? project.id,
        latency_ms: Date.now() - started,
      });
    }

    // --- research_pages upsert (unique per project+url) ---
    let pageId: string;
    let snapshotPath: string | null = null;
    let screenshotPath: string | null = null;

    if (pageExisting) {
      pageId = pageExisting.id;
      const nextVisits = (pageExisting.visit_count ?? 1) + 1;
      await supabase
        .from('research_pages')
        .update({ visit_count: nextVisits, last_seen: nowIso, last_checked_at: nowIso })
        .eq('id', pageId);
    } else {
      const { data: page, error: pageErr } = await supabase
        .from('research_pages')
        .insert({
          project_id: project.id,
          user_id: user.id,
          url,
          domain,
          title,
          snippet: text.slice(0, 180),
          visit_count: 1,
          content_hash: hash,
          last_checked_at: nowIso,
        })
        .select('id')
        .single();
      if (pageErr || !page) {
        return NextResponse.json({ error: `research_pages insert failed: ${pageErr?.message}` }, { status: 500 });
      }
      pageId = page.id;
    }

    // --- snapshots (best-effort; capture must never fail on storage) ---
    if (body.html) {
      snapshotPath = await uploadSnapshot(project.id, pageId, `${hash}.html`, body.html, 'text/html');
    }
    if (body.screenshot) {
      const png = decodeImageDataUrl(body.screenshot);
      if (png) {
        screenshotPath = await uploadSnapshot(project.id, pageId, `shot-${Date.now()}.png`, png, 'image/png');
      }
    }
    if (snapshotPath) {
      await supabase.from('research_pages').update({ snapshot_path: snapshotPath }).eq('id', pageId);
    }

    // --- chunk + embed + store ---
    const parts = splitChunks(text).slice(0, MAX_CHUNKS);
    const vectors: number[][] = [];
    for (let i = 0; i < parts.length; i += EMBED_BATCH) {
      const batch = parts.slice(i, i + EMBED_BATCH);
      const res = await embed({ texts: batch, inputType: 'passage' });
      vectors.push(...res.vectors);
    }
    if (vectors.length !== parts.length) {
      return NextResponse.json({ error: 'embed count mismatch' }, { status: 500 });
    }

    const { data: evt, error: evtErr } = await supabase
      .from('events')
      .insert({
        project_id: project.id,
        user_id: user.id,
        source_type: 'web_research',
        platform: 'web',
        url,
        title,
        content: text,
        content_hash: hash,
        metadata: {
          page_id: pageId,
          page_url: url,
          snapshot_path: snapshotPath,
          screenshot_path: screenshotPath,
          capture: 'extension',
          platform,
        },
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
      embedding: toVectorLiteral(vectors[i] as number[]),
    }));
    const { error: chunkErr } = await supabase.from('chunks').insert(rows);
    if (chunkErr) {
      return NextResponse.json({ error: `chunk insert failed: ${chunkErr.message}` }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      event_id: evt.id,
      page_id: pageId,
      chunks: rows.length,
      dim: 2048,
      url,
      title,
      text_chars: textChars,
      snapshot_path: snapshotPath,
      screenshot_path: screenshotPath,
      project: project.name ?? project.id,
      latency_ms: Date.now() - started,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}