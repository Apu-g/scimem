/** Public config for the extension. Supabase URL + anon key are public by design. */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

/** Default local API during development (user-overridable in the panel). */
export const DEFAULT_API_BASE = 'http://localhost:3000';