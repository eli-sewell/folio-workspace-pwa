create table public.folio_workspaces (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  revision uuid not null default gen_random_uuid(),
  workspace jsonb not null check (jsonb_typeof(workspace) = 'object')
);
alter table public.folio_workspaces enable row level security;
revoke all on public.folio_workspaces from public, anon, authenticated;
grant select, insert, update on public.folio_workspaces to authenticated;
create policy own_workspace on public.folio_workspaces for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
