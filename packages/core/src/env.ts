/**
 * Environment & config module.
 *
 * Every consumer reads validated config through `serverEnv()` / `publicEnv()`.
 * process.env is touched in exactly one place. Missing or malformed variables
 * produce a readable error that names the variable, so failures are obvious.
 *
 * `parseServerEnv`/`parsePublicEnv` are pure (no process.env) so unit tests can
 * feed arbitrary sources. The memoized accessors cache the first success.
 */
import { z } from 'zod';

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NVIDIA_API_KEY: z.string().min(1),
  NVIDIA_EMBED_MODEL: z.string().min(1),
  NVIDIA_EMBED_DIM: z.preprocess(emptyToUndefined, z.number().int().positive()),
  NVIDIA_RERANK_MODEL: z.string().min(1),
  GROQ_API_KEY: z.string().min(1),
  GROQ_MODEL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_MODEL: z.string().min(1),
  APP_BASE_URL: z.string().url(),
});
export type ServerEnv = z.infer<typeof serverEnvSchema>;

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

function emptyToUndefined(v: unknown): unknown {
  if (v === undefined || v === null || v === '') return undefined;
  return typeof v === 'string' ? Number(v) : v;
}

/** Turns a ZodError into a one-line-per-variable summary.
 * A variable is "missing" when its source value is undefined/null/empty —
 * determined from the source object (zod v4 no longer carries `received` on issues). */
function formatEnvErrors(err: z.ZodError, source: Record<string, unknown>): string {
  const problems = err.issues.map((issue) => {
    const path = issue.path.join('.') || '<root>';
    const raw = path !== '<root>' ? source[path] : undefined;
    if (raw === undefined || raw === null || raw === '') {
      return `${path}: missing`;
    }
    return `${path}: ${issue.message}`;
  });
  return [
    'Environment validation failed.',
    'Missing or invalid variables:',
    ...problems.map((p) => `  - ${p}`),
  ].join('\n');
}

/** Pure: validate an arbitrary env-shaped object as server env. */
export function parseServerEnv(source: Record<string, unknown>): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(formatEnvErrors(parsed.error, source));
  }
  return parsed.data;
}

/** Pure: validate an arbitrary env-shaped object as public env. */
export function parsePublicEnv(source: Record<string, unknown>): PublicEnv {
  const parsed = publicEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(formatEnvErrors(parsed.error, source));
  }
  return parsed.data;
}

let serverCache: ServerEnv | null = null;
let publicCache: PublicEnv | null = null;

/** Server-only validated config (reads process.env, caches). */
export function serverEnv(): ServerEnv {
  if (!serverCache) serverCache = parseServerEnv(process.env);
  return serverCache;
}

/** Public (NEXT_PUBLIC_*) validated config (reads process.env, caches). */
export function publicEnv(): PublicEnv {
  if (!publicCache) publicCache = parsePublicEnv(process.env);
  return publicCache;
}

/** Drop memoized values. Used by tests and hot-reload scenarios. */
export function resetEnvCache(): void {
  serverCache = null;
  publicCache = null;
}

export { serverEnvSchema, publicEnvSchema };