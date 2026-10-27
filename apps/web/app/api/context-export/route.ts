import { NextRequest, NextResponse } from 'next/server';
import { authedClient } from '@/lib/supabase/auth';
import { findProjectByName, defaultProject } from '@/lib/pipeline';

export const dynamic = 'force-dynamic';

/** Sanitize a project name down to a safe filename slug. */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}

const MAX_SOURCE_CHARS = 60_000;
const MAX_TOTAL_CHARS = 300_000;

/**
 * GET /api/context-export?projectName=X
 * Emits the whole project's captured context as one portable markdown file,
 * with per-source provenance headers (title, url, platform, captured time).
 * Purpose: download and paste into any OTHER LLM so it has the context your
 * SCIMEM captures built up. ~300k chars ≈ comfortable paste / file-drop size.
 */
export async function GET(req: NextRequest) {
  const { supabase, user } = await authedClient(req);
  if (!supabase || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const projectName = req.nextUrl.searchParams.get('projectName')?.trim();
  const project = projectName
    ? await findProjectByName(supabase, user.id, projectName)
    : await defaultProject(supabase, user.id);

  if (!project) {
    return NextResponse.json(
      {
        error: projectName
          ? `project not found: "${projectName}" — capture something into it first`
          : 'no project yet',
      },
      { status: 404 },
    );
  }

  const { data: events, error: evtErr } = await supabase
    .from('events')
    .select('id, url, title, source_type, content, metadata, captured_at')
    .eq('project_id', project.id)
    .order('captured_at', { ascending: true });

  if (evtErr) return NextResponse.json({ error: `events load failed: ${evtErr.message}` }, { status: 500 });

  const rows = (events ?? []) as Array<{
    id: string;
    url: string | null;
    title: string | null;
    source_type: string | null;
    content: string | null;
    metadata?: { platform?: string; page_id?: string } | null;
    captured_at?: string | null;
  }>;

  const used = rows.filter((r) => r.content && r.content.length > 0);
  const markdown: string[] = [];
  let total = 0;

  markdown.push(`# SCIMEM context — "${project.name ?? project.id}"`);
  markdown.push('');
  markdown.push(
    `Captured ${used.length} source(s). Export generated ${new Date().toUTCString()} by the SCIMEM server.`,
  );
  markdown.push(
    'Paste this file into your other LLM as background context. Each section is one captured page;',
  );
  markdown.push('answer questions from it and cite the page it came from.');
  markdown.push('');
  markdown.push('---');
  markdown.push('');

  for (const [i, r] of used.entries()) {
    const content = (r.content ?? '').slice(0, MAX_SOURCE_CHARS);
    const platform = r.metadata?.platform ?? 'web';
    const captured = r.captured_at ? new Date(r.captured_at).toISOString() : null;

    markdown.push(`## ${i + 1}. ${(r.title || r.url || 'Untitled source').trim()}`);
    markdown.push('');
    const meta = [];
    if (r.url) meta.push(`**URL:** <${r.url}>`);
    if (platform && platform !== 'web') meta.push(`**Platform:** ${platform}`);
    if (captured) meta.push(`**Captured:** ${captured}`);
    if (meta.length) {
      markdown.push(meta.join('  ·  '));
      markdown.push('');
    }
    markdown.push(content.trim());
    markdown.push('');
    markdown.push('---');
    markdown.push('');

    total += content.length;
    if (total >= MAX_TOTAL_CHARS) {
      markdown.push(
        `_Export capped at ${MAX_TOTAL_CHARS.toLocaleString()} chars — ${used.length} of the ` +
          `${rows.length} captured sources included. Re-capture with a narrower scope or thin out ` +
          `the project to get everything._`,
      );
      break;
    }
  }

  const body = markdown.join('\n');
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="scimem-${slugify(project.name ?? project.id)}.md"`,
      'Cache-Control': 'no-store',
    },
  });
}
