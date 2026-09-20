-- S1.5 — Row Level Security (Appendix A RLS block).
-- Multi-tenant boundary: every tenant table has a project-ownership policy;
-- jobs is deliberately policy-less (service-role only), api_tokens keyed on user_id.

create or replace function public.owns_project(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects where id = pid and owner_id = auth.uid());
$$;

alter table projects enable row level security;
create policy projects_owner on projects
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

alter table events enable row level security;
create policy events_owner on events
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id) and user_id = auth.uid());

alter table chunks enable row level security;
create policy chunks_owner on chunks
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

alter table knowledge_items enable row level security;
create policy knowledge_owner on knowledge_items
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

alter table provenance_links enable row level security;
create policy provenance_owner on provenance_links
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id));

alter table research_pages enable row level security;
create policy research_owner on research_pages
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id) and user_id = auth.uid());

alter table queries enable row level security;
create policy queries_owner on queries
  using (public.owns_project(project_id))
  with check (public.owns_project(project_id) and user_id = auth.uid());

alter table api_tokens enable row level security;
create policy tokens_owner on api_tokens
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table jobs enable row level security;  -- no policies: service role only