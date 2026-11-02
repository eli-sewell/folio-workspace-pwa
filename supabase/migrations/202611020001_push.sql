create extension if not exists pg_cron;
create extension if not exists pg_net;
create table public.folio_push_config (
 singleton boolean primary key default true check(singleton),
 secret text not null default encode(extensions.gen_random_bytes(32),'hex'),
 keys jsonb
);
alter table public.folio_push_config enable row level security;
revoke all on public.folio_push_config from public,anon,authenticated;
grant select,update on public.folio_push_config to service_role;
insert into public.folio_push_config default values;
create function public.folio_push_key() returns text language sql security definer set search_path='' as $$
 select keys->>'publicKey' from public.folio_push_config
$$;
revoke all on function public.folio_push_key() from public;
grant execute on function public.folio_push_key() to authenticated;

create table public.folio_push_devices (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null default auth.uid() references auth.users on delete cascade,
 endpoint text unique not null check(length(endpoint)<4096 and endpoint ~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|([a-z0-9-]+[.])*notify[.]windows[.]com|([a-z0-9-]+[.])*push[.]apple[.]com|([a-z0-9-]+[.])*push[.]samsungosp[.]com)/'),
 keys jsonb not null check(length(keys::text)<1024 and keys ?& array['auth','p256dh']),
 registered timestamptz not null default now()
);
alter table public.folio_push_devices enable row level security;
revoke all on public.folio_push_devices from anon,authenticated;
grant select,delete,insert(endpoint,keys) on public.folio_push_devices to authenticated;
grant all on public.folio_push_devices to service_role;
create policy own_devices on public.folio_push_devices to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));

create table public.folio_push_sent (
 device uuid references public.folio_push_devices on delete cascade,
 reminder text, due bigint, retry_at timestamptz not null,
 primary key(device,reminder,due)
);
alter table public.folio_push_sent enable row level security;
revoke all on public.folio_push_sent from public,anon,authenticated;
grant all on public.folio_push_sent to service_role;
create view public.folio_push_due with(security_invoker=true) as
select d.id device,d.endpoint,d.keys,r->>'id' reminder,left(r->>'title',180) title,t.due
from public.folio_push_devices d join public.folio_workspaces w using(owner_id)
cross join lateral jsonb_array_elements(case when jsonb_typeof(w.workspace->'reminders')='array' then w.workspace->'reminders' else '[]'::jsonb end) r
cross join lateral (select case when r->>'time' ~ '^[0-9]{1,15}$' then (r->>'time')::bigint end due) t
where t.due between greatest(extract(epoch from d.registered)*1000,extract(epoch from now()-interval '1 day')*1000) and extract(epoch from now())*1000
and r->>'id' is not null and not exists(select from public.folio_push_sent s where s.device=d.id and s.reminder=r->>'id' and s.due=t.due and s.retry_at>now());
revoke all on public.folio_push_due from public,anon,authenticated;
grant select on public.folio_push_due to service_role;

create function public.folio_claim_push() returns setof public.folio_push_due language sql set search_path='' as $$
with batch as materialized(select * from public.folio_push_due order by due limit 40),
claimed as (insert into public.folio_push_sent as s select device,reminder,due,now()+interval '2 minutes' from batch
on conflict(device,reminder,due) do update set retry_at=excluded.retry_at where s.retry_at<=now() returning device,reminder,due)
select b.* from batch b join claimed using(device,reminder,due)
$$;
revoke all on function public.folio_claim_push() from public,anon,authenticated;
grant execute on function public.folio_claim_push() to service_role;
select cron.schedule('folio-reminder-push','* * * * *',$job$
 select net.http_post(url:='https://xvtwyofntrthslipqifo.supabase.co/functions/v1/folio-reminder-push',headers:=jsonb_build_object('x-folio-job',secret),body:='{}'::jsonb,timeout_milliseconds:=55000)
 from public.folio_push_config where keys is null or exists(select from public.folio_push_due)
$job$);
