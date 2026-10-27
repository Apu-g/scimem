import { NextRequest, NextResponse } from 'next/server';
import { authedClient } from '@/lib/supabase/auth';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/chunks?id=…  — remove a single chunk.
 *
 * Chunk-level rather than project-level deletion: one bad capture or one
 * hallucinated extraction should not cost you the whole project's memory. The
 * parent event stays (it is the provenance record); only the searchable text
 * goes, so retrieval stops returning it immediately.
 *
 * Deleting the LAST chunk of an event leaves an empty shell in the events table
 * and in the trace view. That is deliberate — the capture history is the audit
 * trail — and it disappears with the project.
 */
export async function DELETE(req: NextRequest) {
  const { supabase, user } = await authedClient(req);
  if (!supabase || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = req.nextUrl.searchParams.get('id')?.trim();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabase.from('chunks').delete().eq('id', id);
  if (error) return NextResponse.json({ error: `delete failed: ${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: { id } });
}

/** GET /api/chunks?eventId=… — the chunks of one source, for the trace view. */
export async function GET(req: NextRequest) {
  const { supabase, user } = await authedClient(req);
  if (!supabase || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const eventId = req.nextUrl.searchParams.get('eventId')?.trim();
  if (!eventId) return NextResponse.json({ error: 'eventId required' }, { status: 400 });

  const { data, error } = await supabase
    .from('chunks')
    .select('id, chunk_index, content, token_count, created_at')
    .eq('event_id', eventId)
    .order('chunk_index', { ascending: true });
  if (error) return NextResponse.json({ error: `chunks load failed: ${error.message}` }, { status: 500 });

  return NextResponse.json({ chunks: data ?? [] });
}
