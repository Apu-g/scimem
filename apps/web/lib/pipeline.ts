import type { SupabaseClient } from '@supabase/supabase-js';

/** Split captured text into embed-sized chunks at paragraph boundaries. */
export function splitChunks(content: string, maxChars = 900): string[] {
  const paragraphs = content
    .split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > maxChars) {
      chunks.push(current);
      current = p;
    } else {
      current = current ? `${current}\n\n${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [content];
}

/** Rough token estimate (~4 chars/token). */
export function estTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** sha256 hex — used for content_hash dedupe (whole capture). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface ProjectRow {
  id: string;
}

/** The user's first project, creating a default one on first use. */
export async function defaultProject(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProjectRow | null> {
  const { data: existing } = await supabase
    .from('projects').select('id')
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('projects')
    .insert({ owner_id: userId, name: 'Default', description: 'Created by the prototype playground' })
    .select('id')
    .single();

  if (error) return null;
  return created;
}