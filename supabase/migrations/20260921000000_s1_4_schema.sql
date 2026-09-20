-- S1.4 — Core schema (Appendix A).
-- VECTOR_DIM = 2048 (verified in S1.3b: nvidia/nemotron-3-embed-1b).
-- RLS enable + policies land in S1.5 (appendix splits them; guide steps do too).

-- pgvector hard-ceilings: hnsw on float32 `vector` caps at 2000 dims (an 2048-dim
-- hnsw tuple would exceed the 8KB index page). Column stays vector(2048) for full
-- precision storage; the hnsw index is an EXPRESSION index on embedding::halfvec(2048)
-- (halfvec ceiling = 4000, tuples 2 bytes/elem). Queries must repeat the same cast in
-- ORDER BY — match_chunks does. ~1.5x smaller index, <=0.3 recall cost.

create type source_type as enum ('ai_chat','web_research','git_change','note');
create type knowledge_status as enum ('ACTIVE','SUPERSEDED','ARCHIVED','CONFLICTING','UNVERIFIED','EXPIRED');

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type source_type not null,
  platform text,                     -- chatgpt | claude | gemini | web | git | cli | manual
  url text,
  title text,
  content text not null,             -- already scrubbed
  content_hash text not null,
  metadata jsonb not null default '{}',
  captured_at timestamptz not null default now(),
  unique (project_id, content_hash)
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  token_count int not null,
  embedding vector(2048),
  tsv tsvector generated always as (to_tsvector('english', content)) stored,
  status knowledge_status not null default 'ACTIVE',
  valid_from timestamptz not null default now(),
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);
create index chunks_embedding_idx on chunks using hnsw ((embedding::halfvec(2048)) halfvec_cosine_ops);
create index chunks_tsv_idx on chunks using gin (tsv);
create index chunks_project_status_idx on chunks (project_id, status);

create table knowledge_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('decision','fact','constraint','todo')),
  subject_key text,
  statement text not null,
  status knowledge_status not null default 'ACTIVE',
  confidence real not null default 0.5,
  valid_from timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references knowledge_items(id),
  embedding vector(2048),
  created_at timestamptz not null default now()
);
create index knowledge_project_subject_idx on knowledge_items (project_id, subject_key, status);
create index knowledge_embedding_idx on knowledge_items using hnsw ((embedding::halfvec(2048)) halfvec_cosine_ops);

create table provenance_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  from_type text not null, from_id uuid not null,
  to_type text not null,   to_id uuid not null,
  relation text not null check (relation in ('derived_from','supersedes','conflicts_with','cites','supports')),
  created_at timestamptz not null default now()
);
create index provenance_from_idx on provenance_links (project_id, from_type, from_id);
create index provenance_to_idx   on provenance_links (project_id, to_type, to_id);

create table research_pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  domain text,
  title text,
  snippet text,
  visit_count int not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  content_hash text,
  status knowledge_status not null default 'ACTIVE',
  last_checked_at timestamptz,
  snapshot_path text,
  unique (project_id, url)
);

create table queries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client text not null,               -- extension | cli | dashboard | mcp | eval
  question text not null,
  signals jsonb,
  plan jsonb,                          -- includes strategy + flags
  pack jsonb,                          -- compiled pack + sources + drop reasons
  answer text,
  tokens_raw int, tokens_compiled int, latency_ms int,
  created_at timestamptz not null default now()
);

create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  kind text not null check (kind in ('snapshot','recrawl')),
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- retrieval functions (security invoker => RLS applies) ----------
create or replace function match_chunks(
  p_project uuid, p_embedding vector(2048), p_k int default 30, p_as_of timestamptz default null)
returns table (id uuid, event_id uuid, content text, token_count int, similarity float)
language sql stable security invoker as $$
  select c.id, c.event_id, c.content, c.token_count, 1 - (c.embedding <=> p_embedding)
  from chunks c
  where c.project_id = p_project and c.status <> 'ARCHIVED'
    and (p_as_of is null or c.valid_from <= p_as_of)
  order by (c.embedding::halfvec(2048)) <=> (p_embedding::halfvec(2048))
  limit p_k;
$$;

create or replace function text_search_chunks(
  p_project uuid, p_query text, p_k int default 30, p_as_of timestamptz default null)
returns table (id uuid, event_id uuid, content text, token_count int, rank real)
language sql stable security invoker as $$
  select c.id, c.event_id, c.content, c.token_count,
         ts_rank_cd(c.tsv, websearch_to_tsquery('english', p_query))
  from chunks c
  where c.project_id = p_project and c.status <> 'ARCHIVED'
    and c.tsv @@ websearch_to_tsquery('english', p_query)
    and (p_as_of is null or c.valid_from <= p_as_of)
  order by 5 desc
  limit p_k;
$$;