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

## Verified provider facts (2026-09-20, S1.3b — real calls, mit official docs)

| Item | Value | Notes |
|---|---|---|
| NVIDIA embedding model | `nvidia/nemotron-3-embed-1b` | Real call OK, **dimension = 2048**, 561ms. `nv-embedqa-e5-v5` is EOL (2026-08-25); `embed-qa-4` deprecated. |
| NVIDIA embed endpoint | `POST https://integrate.api.nvidia.com/v1/embeddings` | OpenAI-compatible. **`input_type: "query"\|"passage"` is REQUIRED** (huge accuracy loss if wrong). max input tokens TBD. |
| NVIDIA rerank endpoint | `POST https://ai.api.nvidia.com/v1/retrieval/nvidia/reranking` | Body `{ model, query:{text}, passages:[{text}] }` → `{ rankings:[{index,logit}] }`. **ACCOUNT NOT PROVISIONED: 404 "Function not found for account"** for all rerank models (v1/v2/v3, nemoretriever, integrate host too). Fix: on build.nvidia.com open the rerank model page and generate/associate an API key (maybe add credits). Rerank stays optional behind the gateway with a no-rerank fallback. |
| NVIDIA rerank model | `nvidia/nv-rerankqa-mistral-4b-v3` | NVIDIA's own docs pair it with the embed model (75.45% Recall@5). |
| Groq model | `openai/gpt-oss-20b` | base `https://api.groq.com/openai/v1`, JSON mode OK, 689ms, $.075/M in, 1000 t/s, 131k ctx. Strict JSON schema supported. |
| OpenRouter model | `anthropic/claude-sonnet-5` | base `https://openrouter.ai/api/v1`, 2657ms, $2/$10, 1M ctx. Send `X-Title` header. |

Other caveats:
- `nvidia/nv-embedqa-e5-v5` (assumed by the guide's era) reached EOL 2026-08-25 — caught by live verification.
- Rerank models require account provisioning; CODE IS DONE-ready: `rerank()` will throw a typed error and the pipeline falls back to return order unchanged (matches "simple fallback" rule).

## Still pending (do before code that depends on it)

| Item | Where verified | Value |
|---|---|---|
| NVIDIA embed model max input tokens | S1.3b follow-up | TBD (chunks ~600 tokens, so only matters for research pages) |
| Supabase JWT signing (symmetric vs asymmetric) for PAT minting | S5.6 | TBD |

## Next.js browser env: no whole-`process.env` reads (2026-09-21, PROTO-B fix)

- On the **client**, Next only makes `NEXT_PUBLIC_*` available where the bundler **statically inlined** a direct member expression (`process.env.NEXT_PUBLIC_X`). It does **not** ship a whole `process.env` object — so `publicEnv()`/`parsePublicEnv(process.env)` fails in the browser ("NEXT_PUBLIC_SUPABASE_URL: missing").
- Rule: client-side code must read `NEXT_PUBLIC_*` as static expressions in **app source** and pass the object literal into `parsePublicEnv` for validation. `apps/web/lib/supabase/browser.ts` does exactly this.
- Server (Node) code keeps using `publicEnv()`/`serverEnv()` — full `process.env` exists there.
- `next build` success does NOT prove inlining: verify by grepping the emitted client chunks (`grep -l "<supabase-url>" .next/static`).

## pgvector 2048-dim HNSW — expression index on `halfvec` (2026-09-21, S1.4)

- **Locked fact:** pgvector 0.8.x caps float32 `vector` HNSW/IVFFlat indexes at **2000 dims** (hard compile-time constant; a 2048-dim hnsw tuple would exceed the 8KB index page). No GUC can raise it (`max_hnsw_dims` does not exist — session `SET` returns `42704`).
- **Chosen fix:** columns stay `vector(2048)` (full precision storage is fine — heap limit is 16000). Indexes are expression indexes `USING hnsw ((embedding::halfvec(2048)) halfvec_cosine_ops)` (halfvec ceiling 4000, half the bytes). `match_chunks` repeats the cast in `ORDER BY` so the planner can use them; similarity stays full precision.
- **Cost:** ≤0.3 recall points per published measurements; index ~1.5–3x smaller. Revisit DiskANN (pgvectorscale) if scale demands.
- Rule: any future hnsw index over a >2000-dim `vector` column must use the same halfvec cast pattern.

## Migration driver — Supabase MCP over CLI link/db-push (2026-09-21, S1.3)

- The guide prescribes `supabase login` → `supabase link --project-ref` → `supabase db push`. That flow needs either a CLI access token or a working **database password**; the password in `keys.txt` is rejected by the project's DB (project is in **ap-south-1/Mumbai**; direct `db.<ref>` host currently has no reachable IPv4 record, only a flaky IPv6).
- **Chosen path:** the official hosted Supabase MCP (`mcp.supabase.com`, OAuth as the user's account) drives migrations via `apply_migration(name, query)`. It authenticates at the account level (no DB password), records each migration in `supabase_migrations.schema_migrations` (verified: `v20260920183239 enable_extensions`), and `execute_sql` covers verification queries.
- Rule going forward: **every schema change ships as a versioned file under `supabase/migrations/` AND is applied to the cloud via `apply_migration` with the same name+SQL**; verify with `list_migrations` that the version recorded matches.
- DB password reset remains optional (needed only if we ever switch back to CLI `db push`/`db reset` locally). Not blocking.

## Extension capture pipeline — PROTO-C (2026-09-21)

- **Surface:** side panel (WXT 0.21.4, React 19, Tailwind v4, Chrome MV3). Toolbar click opens the panel via `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`. `.output/chrome-mv3` is the loadable artifact.
- **Capture flow (no persistent content script):** background `chrome.scripting.executeScript` reads the **active tab's live DOM** (`document.documentElement.outerHTML`, i.e. post-JS state) and `chrome.tabs.captureVisibleTab` grabs a PNG of the visible viewport; the panel POSTs `{url, title, html, screenshot}` to `/api/capture-page`. Requires `host_permissions: ['<all_urls>']` + `activeTab`/`scripting`/`tabs` — re-audit which hosts are actually needed at S4.9 (guide's review note).
- **Extraction is server-side** (`lib/extract.ts`, cheerio: strip script/style/nav/footer/aside/etc., then largest of `main`/`article`/`[role=main]`/`body`). One implementation, raw HTML preserved rather than parsed client-side → enables the future Playwright re-crawl.
- **Snapshots:** private `snapshots` storage bucket (service-role upload inside the route; a storage failure must never fail a capture — paths degrade to null and the rest of the pipeline continues). Paths land on `research_pages.snapshot_path` and event metadata (`page_id`, `snapshot_path`, `screenshot_path`) → the URL + HTML/PNG anchors for Graphiti backtracking and S9 re-crawl.
- **Ask-scoping semantics:** capture-side project resolution **creates** a named project on demand (`resolveProject`); ask-side resolution **never creates** (`findProjectByName`, 404 with a hint). Prevents a typo in the project field from silently minting empty projects.
- **Dedupe is project-wide, not page-wide:** the events unique constraint is `(project_id, content_hash)` — the same article captured at a *different* URL must not be stored twice. `/api/capture-page` checks that constraint **before any storage write or embedding**; a duplicate still records/bumps the `research_pages` row (visit tracking) but re-uploads nothing and re-embeds nothing (re-uploading an existing object name would 400 on storage; the earlier ordering only deduped when the page URL had been seen before, which let a new URL with identical content hit the unique-constraint 500).
- **CORS middleware** for `/api/*`: `Access-Control-Allow-Origin: *` + preflight handling, because the extension origin (`chrome-extension://…`) is cross-origin to `http://localhost:3000`. Permissive in dev; tighten to an allow-list at deploy (S3.3).
- **WXT 0.21 gotchas:** `defineBackground` moved to `wxt/utils/define-background`; the generated `.wxt/tsconfig.json` includes `../**/*` which drags root `node_modules` `.d.ts` into typecheck — the extension uses its own tsconfig extending `tsconfig.base.json` with **no `@/` alias** (relative imports only; the alias made tsc's inferred background type non-portable, TS2742).
- Demo/hint text in the panel UI must never contain credentials (email-only hint; password stays in `.env.local`).

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
- **2026-09-21 (S1.6/prototype):** REVISED — workspace packages now point `exports`/`types` at **`./dist/*.js`** (compiled + `.d.ts`). Next/webpack enforces `fullySpecified` for ESM packages in `node_modules`, and its TS loader does not apply the `.js → .ts` mapping there (webpack literally searched `./env.js` and `./chat.js` inside the raw-`.ts` package and failed). Relative imports inside packages use explicit `.js` specifiers (TS maps them to `.ts` in source, and they are correct in emitted ESM). Dev loop: `pnpm -r build` after editing a package. Tests still resolve fine (they import relative source or the built package).
- **2026-09-20 (S1.2):** zod **v4** dropped the `received` field on `invalid_type` issues — a formatter must judge "missing" from the source object (undefined/null/'') instead of the error shape. Applied in `env.ts`.
- **2026-09-20 (S1.2):** The guide's env table (§5) has no server-side `SUPABASE_URL`; the Supabase URL lives only in `NEXT_PUBLIC_SUPABASE_URL`. Removed the redundant var so `serverEnv()` matches the guide exactly.
- **2026-09-20 (S1.2):** Real `.env.local` check fails fast listing only the five model vars (`NVIDIA_EMBED_MODEL/DIM/RERANK_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`) that S1.3b must verify. Intended.