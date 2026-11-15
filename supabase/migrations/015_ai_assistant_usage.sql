-- Infrastructure counters only. The assistant has no business-data write tools.
begin;
create table public.ai_assistant_usage (
  bucket text primary key,
  requests integer not null default 0,
  expires_at timestamptz not null
);
alter table public.ai_assistant_usage enable row level security;
revoke all on public.ai_assistant_usage from public, anon, authenticated;

create function public.consume_ai_assistant_usage() returns boolean
language plpgsql security definer set search_path = '' set statement_timeout = '3s' as $$
declare
  uid uuid := auth.uid();
  minute_key text := 'minute:' || uid::text || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24MI');
  user_key text := 'day:' || uid::text || ':' || to_char(now() at time zone 'UTC', 'YYYYMMDD');
  global_key text := 'global:' || to_char(now() at time zone 'UTC', 'YYYYMMDD');
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid and role in ('owner', 'manager')) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;
  -- Shared lock makes the global and user quotas atomic across serverless instances.
  perform pg_advisory_xact_lock(79215015);
  delete from public.ai_assistant_usage where expires_at < now();
  if coalesce((select requests from public.ai_assistant_usage where bucket = minute_key), 0) >= 6
    or coalesce((select requests from public.ai_assistant_usage where bucket = user_key), 0) >= 40
    or coalesce((select requests from public.ai_assistant_usage where bucket = global_key), 0) >= 300 then
    return false;
  end if;
  insert into public.ai_assistant_usage(bucket, requests, expires_at)
    values (minute_key, 1, now() + interval '2 minutes'), (user_key, 1, now() + interval '2 days'), (global_key, 1, now() + interval '2 days')
    on conflict (bucket) do update set requests = public.ai_assistant_usage.requests + 1;
  return true;
end;
$$;
revoke all on function public.consume_ai_assistant_usage() from public, anon;
grant execute on function public.consume_ai_assistant_usage() to authenticated;
commit;
