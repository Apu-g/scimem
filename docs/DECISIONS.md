# SCIMEM — Recorded Decisions & Verified Facts

> Rule: verify external APIs from official docs before coding; record everything here.
> This file grows every time we verify a model ID, dimension, endpoint, or make a design tradeoff.

## Environment (2026-09-20)

- Node **v26.9.0**, npm **12.0.2**, git **2.55.0**, Chrome at `/opt/google/chrome/chrome`
- **pnpm 12.5.1** installed to `~/.local/bin` (global npm install to `/usr` failed: no permissions). `~/.local/bin` added to `PATH` in `~/.bashrc`.
- Supabase cloud project exists: `xccudezjjdtzpyojyodp` (see keys.txt, never committed).
  - keys.txt includes an **anon JWT**, a **service-role JWT**, and a newer **`sb_publishable_…`** key.
  - New Supabase projects ship `sb_publishable_*` keys; **TO VERIFY in S3.1**: whether the anon JWT still works with `supabase-js` for user-scoped clients, or whether we must use the publishable key (records recommendation in S3.1/RLS testing).
- Provider keys present (NVIDIA, Groq, OpenRouter). Vercel account not yet created — required at S3.3.

## Pending verification (do before the code that depends on it)

| Item | Where verified | Value |
|---|---|---|
| NVIDIA embedding model ID | S1.3b | TBD (affects `VECTOR_DIM`) |
| NVIDIA embedding output dimension | S1.3b | TBD |
| NVIDIA embedding max input tokens / `input_type` (query vs passage) | S1.3b | TBD |
| NVIDIA rerank model + endpoint/request shape | S1.3b | TBD |
| Groq fast-JSON model ID | S1.3b | TBD |
| OpenRouter answer model ID | S1.3b | TBD |
| Groq/OpenRouter OpenAI-compat base URLs | S2.1 | TBD |
| Supabase JWT signing (symmetric vs asymmetric) for PAT minting | S5.6 | TBD |

## Locked decisions (from guide §2 — do not change without telling the user)

- Cloud: Vercel (web+API), Supabase (Postgres+pgvector+tsvector+Auth+Storage), separate worker host later.
- Embeddings/rerank = NVIDIA; fast LLM = Groq; answer generation = OpenRouter (Groq fallback).
- TypeScript strict everywhere; pnpm workspaces monorepo; Next.js App Router; WXT+React+Tailwind extension; zod on every API boundary.
- RLS on every table; user-scoped Supabase client in API; service-role server-side only.
- Provider keys server-side only; extension holds only Supabase URL + anon key + API base URL.

## Tradeoffs observed during the build

- **2026-09-20 (S1.1):** TypeScript **7.0.2** (native compiler) is NOT yet supported by `typescript-eslint` 8.70 ("typescript-eslint does not support TS 7.0"). Pinned the workspace to **typescript ~5.9.3** for tooling compatibility. Revisit TS 7 once typescript-eslint ships support (tracked: typescript-eslint/typeascript-eslint#10940).
- **2026-09-20 (S1.1):** ESLint **10.11.0** + flat config (`eslint.config.mjs` with `tseslint.config` + `eslint-config-prettier`) works at the workspace root.
- **2026-09-20 (S1.1):** Workspace packages export their **TypeScript source** (`exports → ./src/index.ts`). Vitest/vite and `moduleResolution: bundler` resolve it directly, so packages import each other with zero build step in dev. `tsc -p tsconfig.build.json` produces `dist/` for release artifacts (test files excluded).