begin;
-- Private, actor-bound previews. Model output never has database write access.
create table public.ai_attendance_imports (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
  actor_role text not null check(actor_role in ('owner','manager')), event_id uuid not null references public.events(id),
  fingerprint text not null, payload jsonb not null, expected jsonb not null, allow_new boolean not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '10 minutes',
  status text not null default 'pending' check(status in ('pending','succeeded','stale','expired'))
);
create index on public.ai_attendance_imports(actor_id,fingerprint,created_at desc);
create table public.ai_attendance_audit (
  id bigint generated always as identity primary key, import_id uuid not null references public.ai_attendance_imports(id),
  actor_id uuid not null references auth.users(id), assignment_id uuid not null,
  before_values jsonb, after_values jsonb not null, occurred_at timestamptz not null default now()
);
alter table public.ai_attendance_imports enable row level security;
alter table public.ai_attendance_audit enable row level security;
revoke all on public.ai_attendance_imports, public.ai_attendance_audit from public, anon, authenticated;
grant all on public.ai_attendance_imports to service_role;
grant select,insert on public.ai_attendance_audit to service_role;
grant usage,select on sequence public.ai_attendance_audit_id_seq to service_role;
grant select on public.ai_attendance_audit to authenticated;
create policy "Owners read attendance audit" on public.ai_attendance_audit for select to authenticated using(exists(select 1 from public.profiles where id=auth.uid() and role='owner'));

create function public.ai_attendance_catalog(p_day int,p_month int,p_year int) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'events',coalesce((select jsonb_agg(to_jsonb(e)) from (select id,event_date,venue_id,client_name from public.events where extract(day from event_date)=p_day and extract(month from event_date)=p_month and (p_year is null or extract(year from event_date)=p_year) order by event_date,id limit 501) e),'[]'::jsonb),
    'venues',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name)) from public.venues),'[]'::jsonb),
    'employees',coalesce((select jsonb_agg(to_jsonb(e)) from (select id,full_name from public.employees where active order by id limit 2001) e),'[]'::jsonb)
  );
$$;
create function public.ai_attendance_snapshot(p_event uuid,p_employees uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object(
    'event',(select jsonb_build_object('id',id,'event_date',event_date,'venue_id',venue_id,'client_name',client_name) from public.events where id=p_event),
    'employees',coalesce((select jsonb_agg(jsonb_build_object('id',id,'full_name',full_name,'active',active,'default_hourly_rate',default_hourly_rate) order by id) from public.employees where id=any(p_employees)),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from public.event_assignments a where employee_id=any(p_employees)),'[]'::jsonb)
  );
$$;
create function public.register_ai_attendance(p_actor uuid,p_role text,p_event uuid,p_payload jsonb,p_expected jsonb,p_fingerprint text,p_allow_new boolean) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='8s' as $$
declare p public.ai_attendance_imports;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role=p_role and role in ('owner','manager')) then raise exception 'Unauthorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_fingerprint,0));
  select * into p from public.ai_attendance_imports i where actor_id=p_actor and actor_role=p_role and fingerprint=p_fingerprint and (
    (status='succeeded' and not exists(
      select 1 from jsonb_array_elements(p_payload) r where not exists(
        select 1 from public.event_assignments a where a.event_id=p_event and a.employee_id=(r->>'employee_id')::uuid
          and a.work_start=(r->>'work_start')::timestamptz and a.work_end=(r->>'work_end')::timestamptz
      )
    )) or (status='pending' and expires_at>now() and expected=p_expected and allow_new=p_allow_new)
  ) order by created_at desc limit 1;
  if p.id is null then
    if (select count(*) from public.ai_attendance_imports where actor_id=p_actor and created_at>now()-interval '1 hour')>=100 then raise exception 'Too many previews'; end if;
    insert into public.ai_attendance_imports(actor_id,actor_role,event_id,fingerprint,payload,expected,allow_new) values(p_actor,p_role,p_event,p_fingerprint,p_payload,p_expected,p_allow_new) returning * into p;
  end if;
  return jsonb_build_object('id',p.id,'expires_at',p.expires_at);
end;
$$;
create function public.confirm_ai_attendance(p_actor uuid,p_proposal uuid) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='12s' as $$
declare p public.ai_attendance_imports; live_role text; ids uuid[]; r jsonb; a public.event_assignments; old_value jsonb; eid uuid; s timestamptz; e timestamptz; d date;
begin
  select role into live_role from public.profiles where id=p_actor for share;
  select * into p from public.ai_attendance_imports where id=p_proposal and actor_id=p_actor for update;
  if p.id is null or live_role not in ('owner','manager') or live_role is distinct from p.actor_role then return jsonb_build_object('status','forbidden'); end if;
  if p.status='succeeded' then return jsonb_build_object('status','succeeded','eventId',p.event_id,'replayed',true); end if;
  if p.status<>'pending' then return jsonb_build_object('status',p.status); end if;
  if p.expires_at<=now() then update public.ai_attendance_imports set status='expired' where id=p.id; return jsonb_build_object('status','expired'); end if;
  -- Serializes against all existing assignment API paths, including inserts without unique constraints.
  lock table public.event_assignments in share row exclusive mode;
  select event_date into d from public.events where id=p.event_id for update;
  select array_agg((v->>'employee_id')::uuid order by v->>'employee_id') into ids from jsonb_array_elements(p.payload) v;
  if coalesce(array_length(ids,1),0) not between 1 and 200 or (select count(distinct x) from unnest(ids) x)<>array_length(ids,1) then raise exception 'Invalid employees'; end if;
  perform id from public.employees where id=any(ids) order by id for update;
  if public.ai_attendance_snapshot(p.event_id,ids) is distinct from p.expected then update public.ai_attendance_imports set status='stale' where id=p.id; return jsonb_build_object('status','stale'); end if;
  for r in select value from jsonb_array_elements(p.payload) loop
    if exists(select 1 from jsonb_object_keys(r) k where not(k=any(array['employee_id','work_start','work_end','minutes','note']))) then raise exception 'Forbidden field'; end if;
    eid := (r->>'employee_id')::uuid; s := (r->>'work_start')::timestamptz; e := (r->>'work_end')::timestamptz;
    if d is null or s is null or e is null or e<=s or e-s>interval '16 hours' or (s at time zone 'Asia/Jerusalem')::date<>d or (e at time zone 'Asia/Jerusalem')::date not in (d,d+1) or ((e at time zone 'Asia/Jerusalem')::date=d+1 and (e at time zone 'Asia/Jerusalem')::time>='12:00') then raise exception 'Invalid times'; end if;
    if not exists(select 1 from public.employees where id=eid and active) then raise exception 'Inactive employee'; end if;
    if (select count(*) from public.event_assignments where event_id=p.event_id and employee_id=eid)>1 then raise exception 'Duplicate assignments'; end if;
    if exists(select 1 from public.event_assignments where employee_id=eid and event_id<>p.event_id and work_start<e and (work_end is null or work_end>s)) then raise exception 'Overlapping attendance'; end if;
    select * into a from public.event_assignments where event_id=p.event_id and employee_id=eid;
    old_value := case when a.id is null then null else jsonb_build_object('work_start',a.work_start,'work_end',a.work_end,'notes',a.notes) end;
    if a.id is null then
      if not p.allow_new then raise exception 'Assignment approval required'; end if;
      insert into public.event_assignments(event_id,employee_id,event_role,role,is_manager,pay_type,hourly_rate,fixed_pay,work_start,work_end,notes)
      select p.event_id,eid,'bartender','bartender',false,'hourly',default_hourly_rate,null,s,e,nullif(r->>'note','') from public.employees where id=eid returning * into a;
    else
      update public.event_assignments set work_start=s,work_end=e,notes=case when coalesce(r->>'note','')='' or coalesce(notes,'') like '%'||(r->>'note')||'%' then notes else concat_ws('; ',nullif(notes,''),r->>'note') end where id=a.id returning * into a;
    end if;
    insert into public.ai_attendance_audit(import_id,actor_id,assignment_id,before_values,after_values) values(p.id,p_actor,a.id,old_value,jsonb_build_object('work_start',a.work_start,'work_end',a.work_end,'notes',a.notes));
  end loop;
  update public.ai_attendance_imports set status='succeeded' where id=p.id;
  insert into public.ai_action_audit(actor_id,action,target_id,outcome) values(p_actor,'import_attendance',p.event_id,'succeeded');
  return jsonb_build_object('status','succeeded','eventId',p.event_id,'replayed',false);
end;
$$;
revoke all on function public.ai_attendance_catalog(int,int,int), public.ai_attendance_snapshot(uuid,uuid[]), public.register_ai_attendance(uuid,text,uuid,jsonb,jsonb,text,boolean), public.confirm_ai_attendance(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ai_attendance_catalog(int,int,int), public.ai_attendance_snapshot(uuid,uuid[]), public.register_ai_attendance(uuid,text,uuid,jsonb,jsonb,text,boolean), public.confirm_ai_attendance(uuid,uuid) to service_role;
commit;
