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
  name?: string;
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

/**
 * Resolve the target project for a request.
 * - name given: find it; if missing, CREATE it (capture-side behavior).
 * - no name:    fall back to the user's first project (playground behavior).
 */
export async function resolveProject(
  supabase: SupabaseClient,
  userId: string,
  name?: string,
): Promise<ProjectRow | null> {
  if (name?.trim()) {
    const trimmed = name.trim();
    const { data: byName } = await supabase
      .from('projects').select('id')
      .eq('owner_id', userId)
      .eq('name', trimmed)
      .limit(1)
      .maybeSingle();
    if (byName) return byName;
    const { data: created, error } = await supabase
      .from('projects')
      .insert({ owner_id: userId, name: trimmed, description: 'Created from the SCIMEM extension' })
      .select('id')
      .single();
    if (error) return null;
    return created;
  }
  return defaultProject(supabase, userId);
}

/**
 * Resolve a project by name WITHOUT creating it (ask-side behavior:
 * asking about a project that has never captured anything is an error the
 * caller can surface, not an implicit creation).
 */
export async function findProjectByName(
  supabase: SupabaseClient,
  userId: string,
  name: string,
): Promise<ProjectRow | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data } = await supabase
    .from('projects').select('id')
    .eq('owner_id', userId)
    .eq('name', trimmed)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}