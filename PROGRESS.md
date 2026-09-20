# SCIMEM — Build Progress

Status legend: `TODO` | `DONE` | `BLOCKED`
All dates in `YYYY-MM-DD`. Updated at the end of every step (Agent Protocol rule 7).

| Step | Title | Status | Date | Notes |
|---|---|---|---|---|
| S0.1 | Accounts and keys | DONE | 2026-09-20 | all keys in keys.txt (git-ignored); pnpm 12.5.1 via ~/.local/bin; Vercel pending until S3.3 |
| S0.2 | Repo and tooling check | DONE | 2026-09-20 | git init, PROGRESS.md, DECISIONS.md, .gitignore (secrets guarded), first commit b943b20; GitHub push pending auth |
| S1.1 | Monorepo scaffold | DONE | 2026-09-20 | pnpm workspace, TS strict base, eslint+prettier flat config, @scimem/core with hello(), vitest root config |
| S1.2 | Env and config module | DONE | 2026-09-20 | zod-validated serverEnv()/publicEnv() with fail-fast, .env.example files, real .env.local from keys.txt (git-ignored) |
| S1.3 | Supabase project link and migration flow | DONE | 2026-09-21 | Extensions `vector` 0.8.2 + `pgcrypto` 1.3 installed via Supabase MCP `apply_migration` (recorded as v20260920183239 `enable_extensions`); `select * from pg_extension` returns both rows; local migration file renamed to match recorded version |
| S1.3b | Verify provider facts (embedding model and dimension) | DONE | 2026-09-20 | embed=nvidia/nemotron-3-embed-1b (2048), rerank endpoint verified but account not provisioned, groq=openai/gpt-oss-20b, openrouter=anthropic/claude-sonnet-5 |
| S1.4 | Core schema migration | DONE | 2026-09-21 | 9 tables (Appendix A) + indexes + match_chunks/text_search_chunks applied as v20260920184050; hnsw indexes on embedding::halfvec(2048) expression (pgvector 2000-dim float32 ceiling) |
| S1.4 | Core schema migration | TODO | | |
| S1.5 | Row Level Security + isolation test | TODO | | |
| S2.1 | Chat and embedding clients | TODO | | |
| S2.2 | Rerank client | TODO | | |
| S2.3 | Token counter and fake gateway | TODO | | |
| S3.1 | Next.js app, health, auth helper, CORS | TODO | | |
| S3.2 | Projects endpoints | TODO | | |
| S3.3 | Deploy API to Vercel (early on purpose) | TODO | | |
| S3.4 | Capture endpoint and ingestion pipeline | TODO | | |
| S3.5 | Ask endpoint v1 (hybrid RAG baseline) | TODO | | |
| S3.6 | Trace, research, and query-history endpoints | TODO | | |
| S4.1 | Scaffold and side panel | TODO | | |
| S4.2 | Authentication in the panel | TODO | | |
| S4.3 | API client and project switcher | TODO | | |
| S4.4 | Ask tab | TODO | | |
| S4.5 | Capture (ChatGPT adapter first) | TODO | | |
| S4.6 | More capture sources (one sub-step at a time) | TODO | | |
| S4.6a | Selection capture | TODO | | |
| S4.6b | Claude adapter | TODO | | |
| S4.6c | Gemini adapter | TODO | | |
| S4.7 | Research mode with privacy controls | TODO | | |
| S4.8 | Trace tab | TODO | | |
| S4.9 | UI polish and packaging | TODO | | |
| S5.1 | Auth pages and app shell | TODO | | |
| S5.2 | Projects list and create | TODO | | |
| S5.3 | Project overview and analysis | TODO | | |
| S5.4 | Knowledge tab (placeholder) | TODO | | |
| S5.5 | Downloads page | TODO | | |
| S5.6 | Settings and personal access tokens (PAT) | TODO | | |
| S5.7 | Dashboard polish and deploy | TODO | | |
| S6.1 | Knowledge extraction | TODO | | |
| S6.2 | Temporal supersession | TODO | | |
| S6.3 | Authority, freshness, and conflict scoring | TODO | | |
| S6.4 | Active task inference | TODO | | |
| S6.5 | Adaptive retrieval planner | TODO | | |
| S6.6 | Token budget optimizer | TODO | | |
| S6.7 | Context compiler and pack | TODO | | |
| S6.8 | Wire into ask, extension, dashboard | TODO | | |
| S7.1 | Scaffold | TODO | | |
| S7.2 | Login, whoami, project binding | TODO | | |
| S7.3 | ask, trace, research, status | TODO | | |
| S7.4 | capture | TODO | | |
| S7.5 | Sessions and git hooks | TODO | | |
| S7.6 | context command | TODO | | |
| S7.7 | Slash-command REPL | TODO | | |
| S8.1 | stdio MCP server | TODO | | |
| S8.2 | Connect to OpenCode (and test) | TODO | | |
| S9.1 | Worker service and job queue | TODO | | |
| S9.2 | Snapshot and highlighted screenshot | TODO | | |
| S9.3 | Re-crawl and staleness detection | TODO | | |
| S9.4 | Deploy worker | TODO | | |
| S10.1 | Benchmark specification | TODO | | |
| S10.2 | Dataset builder | TODO | | |
| S10.3 | Baseline and ablation runner | TODO | | |
| S10.4 | Metrics and report | TODO | | |
| S10.5 | (Optional) External-evidence freshness experiment | TODO | | |
| S11.1 | Security review | TODO | | |
| S11.2 | Cost and rate guard | TODO | | |
| S11.3 | Docs and demo | TODO | | |