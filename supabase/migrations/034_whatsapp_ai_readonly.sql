begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Additive, single-business TAYO adapter. Never install 029/031/032 for this feature.
do $sources$
declare expected record; p pg_proc; definition text;
begin
 if exists(select 1 from unnest(ARRAY['banned_until','deleted_at']) n where not exists(select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name=n)) then raise exception 'Auth user activity columns required';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name in ('events','profiles','venues','employees') and column_name in ('tenant_id','business_id','organization_id')) then raise exception '034 supports one TAYO business per project only; tenant-aware reads required';end if;
 if to_regclass('public.whatsapp_ai_tasks') is not null then raise exception '034 already installed; verify instead of reinstalling';end if;
 if to_regclass('public.whatsapp_ai_usage') is not null or to_regclass('public.whatsapp_ai_audit') is not null or to_regclass('public.whatsapp_ai_control') is not null or to_regclass('public.whatsapp_ai_senders') is not null or exists(
  select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('whatsapp_ai_priority_busy','receive_whatsapp_ai','whatsapp_ai_identity','claim_whatsapp_ai','read_whatsapp_ai_snapshot','complete_whatsapp_ai','ack_whatsapp_ai','fail_whatsapp_ai_delivery','whatsapp_ai_user_active','whatsapp_ai_access','set_whatsapp_ai_control','set_whatsapp_ai_sender','read_whatsapp_ai_admin','whatsapp_ai_control_changed','whatsapp_ai_allowlist_changed'))
 then raise exception 'Preexisting 034 objects/overloads; inspect before installing';end if;
 if to_regprocedure('public.prepare_whatsapp_event_selection(uuid,uuid,jsonb,jsonb,jsonb,uuid[])') is null then raise exception '033 required';end if;
 for expected in select * from(values
 ('public.receive_whatsapp_attendance(text,text,text,text,timestamp with time zone)',ARRAY['b68c2839dbf100c5da47bcca8a0c0be2','25e1b9ed098814007e3e35fc33b1724a']),
 ('public.claim_whatsapp_attendance(boolean)',ARRAY['e899d01490b7fafc5c5ee2b16cf232e3'])) x(signature,hashes) loop
  select * into p from pg_proc where oid=to_regprocedure(expected.signature);
  if p.oid is null or p.prosecdef or p.proconfig is distinct from ARRAY['search_path=""']::text[]
   or not (md5(btrim(replace(p.prosrc,chr(13),''),chr(32)||chr(9)||chr(10)))=any(expected.hashes))
   or pg_get_userbyid(p.proowner)<>'postgres'
   or not has_function_privilege('service_role',p.oid,'EXECUTE')
   or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
  then raise exception 'Unreviewed 034 prerequisite: %; no overwrite',expected.signature;end if;
 end loop;
end;$sources$;

-- Extend only the routing discriminator, preserving both existing report types.
do $$declare c record;begin
 for c in select conname,pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.whatsapp_attendance_inbox'::regclass and contype='c' and pg_get_constraintdef(oid) like '%report_type%' loop
  if c.def not like '%attendance%' or c.def not like '%inventory%' then raise exception 'Unknown report_type constraint';end if;
  execute format('alter table public.whatsapp_attendance_inbox drop constraint %I',c.conname);
 end loop;
end;$$;
alter table public.whatsapp_attendance_inbox add constraint whatsapp_report_type_034 check(report_type in ('attendance','inventory','ai_question'));

-- Preserve legacy bodies/ACLs. Only exclude AI from their claim/rate-limit scope.
do $$declare definition text; before_row pg_proc; after_row pg_proc; source_hash text; target_hash text;begin
 select * into before_row from pg_proc where oid='public.receive_whatsapp_attendance(text,text,text,text,timestamptz)'::regprocedure;
 source_hash:=md5(btrim(replace(before_row.prosrc,chr(13),''),chr(32)||chr(9)||chr(10)));
 -- Exact reviewed pairs: 020 raises at the cap; Production returns false.
 -- Patch the active definition, never install the other variant's body.
 target_hash:=case source_hash when 'b68c2839dbf100c5da47bcca8a0c0be2' then '8946438f48517f966676373073bf617c'
  when '25e1b9ed098814007e3e35fc33b1724a' then 'd65c10859435cebe0693f8071913700e' else null end;
 if target_hash is null then raise exception 'Unreviewed receive source; no overwrite';end if;
 definition:=pg_get_functiondef('public.receive_whatsapp_attendance(text,text,text,text,timestamptz)'::regprocedure);
 if cardinality(string_to_array(before_row.prosrc,'where phone=p_phone and received_at'))<>2 then raise exception 'Unexpected receive body';end if;
 execute replace(definition,'where phone=p_phone and received_at','where report_type<>''ai_question'' and phone=p_phone and received_at');
 select * into after_row from pg_proc where oid=before_row.oid;
 if md5(btrim(replace(after_row.prosrc,chr(13),''),chr(32)||chr(9)||chr(10)))<>target_hash
  or (to_jsonb(after_row)-'prosrc') is distinct from (to_jsonb(before_row)-'prosrc')
 then raise exception 'Receive post-upgrade hash/metadata mismatch';end if;
 select * into before_row from pg_proc where oid='public.claim_whatsapp_attendance(boolean)'::regprocedure;
 if md5(btrim(replace(before_row.prosrc,chr(13),''),chr(32)||chr(9)||chr(10)))<>'e899d01490b7fafc5c5ee2b16cf232e3' then raise exception 'Unreviewed claim source';end if;
 definition:=pg_get_functiondef('public.claim_whatsapp_attendance(boolean)'::regprocedure);
 if strpos(definition,'public.whatsapp_attendance_inbox where attempts<5')=0 or strpos(definition,'public.whatsapp_attendance_receipts where attempts<5')=0 then raise exception 'Unexpected claim body';end if;
 definition:=replace(definition,'public.whatsapp_attendance_inbox where attempts<5','public.whatsapp_attendance_inbox where report_type<>''ai_question'' and attempts<5');
 definition:=replace(definition,'public.whatsapp_attendance_receipts where attempts<5','public.whatsapp_attendance_receipts where kind<>''ai_answer'' and attempts<5');
 execute definition;
 select * into after_row from pg_proc where oid=before_row.oid;
 if md5(btrim(replace(after_row.prosrc,chr(13),''),chr(32)||chr(9)||chr(10)))<>'167604d06753b5279d1bd16e001aa850'
  or (to_jsonb(after_row)-'prosrc') is distinct from (to_jsonb(before_row)-'prosrc')
 then raise exception 'Claim post-upgrade hash/metadata mismatch';end if;
end;$$;

create table public.whatsapp_ai_tasks(
 inbox_id uuid primary key references public.whatsapp_attendance_inbox(id),
 status text not null default 'pending' check(status in ('pending','processing','ready','sending','sent','expired','delivery_unknown')),
 attempts integer not null default 0 check(attempts between 0 and 2), lease_token uuid,lease_until timestamptz,
 actor_role text check(actor_role in ('owner','manager')),answer text check(length(answer)<=3800),
 error_code text,created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '20 minutes',
 provider_message_id text
);
create index whatsapp_ai_pending on public.whatsapp_ai_tasks(status,created_at);
create table public.whatsapp_ai_usage(bucket text primary key,requests integer not null,expires_at timestamptz not null);
create table public.whatsapp_ai_audit(id bigint generated always as identity primary key,inbox_id uuid references public.whatsapp_ai_tasks(inbox_id),action text not null,created_at timestamptz not null default now(),actor_id uuid references auth.users(id) on delete set null);
create table public.whatsapp_ai_control(singleton boolean primary key default true check(singleton),enabled boolean not null default false,phone_number_id text,revision bigint not null default 0,updated_by uuid references auth.users(id) on delete set null,updated_at timestamptz not null default now());
insert into public.whatsapp_ai_control(singleton) values(true);
create table public.whatsapp_ai_senders(phone text primary key references public.whatsapp_attendance_senders(phone) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,enabled boolean not null default false,updated_by uuid references auth.users(id) on delete set null,updated_at timestamptz not null default now());
alter table public.whatsapp_ai_tasks add column policy_revision bigint not null;
alter table public.whatsapp_ai_control enable row level security;
alter table public.whatsapp_ai_senders enable row level security;
revoke all on public.whatsapp_ai_control,public.whatsapp_ai_senders from public,anon,authenticated,service_role;
grant select on public.whatsapp_ai_control,public.whatsapp_ai_senders to service_role;
alter table public.whatsapp_ai_tasks enable row level security;
alter table public.whatsapp_ai_usage enable row level security;
alter table public.whatsapp_ai_audit enable row level security;
revoke all on public.whatsapp_ai_tasks,public.whatsapp_ai_usage,public.whatsapp_ai_audit from public,anon,authenticated,service_role;
grant select,insert,update on public.whatsapp_ai_tasks,public.whatsapp_ai_usage to service_role;
grant select,insert on public.whatsapp_ai_audit to service_role;
grant usage,select on sequence public.whatsapp_ai_audit_id_seq to service_role;

create function public.whatsapp_ai_control_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.revision:=old.revision+1;new.updated_at:=clock_timestamp();new.updated_by:=auth.uid();
 insert into public.whatsapp_ai_audit(action,actor_id) values('policy_revision_changed',auth.uid());return new;
end;$$;
create trigger whatsapp_ai_control_revision before update on public.whatsapp_ai_control for each row execute function public.whatsapp_ai_control_changed();
create function public.whatsapp_ai_allowlist_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.whatsapp_ai_control set revision=revision+1 where singleton;return null;end;$$;
create trigger whatsapp_ai_allowlist_revision after insert or update or delete on public.whatsapp_ai_senders for each row execute function public.whatsapp_ai_allowlist_changed();

create function public.whatsapp_ai_user_active(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from auth.users where id=p_user and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()));
$$;
create function public.whatsapp_ai_access(p_phone text,p_actor uuid,p_phone_id text) returns text language sql stable security definer set search_path='' as $$
 select p.role from public.whatsapp_ai_control c join public.whatsapp_ai_senders a on a.phone=p_phone and a.user_id=p_actor and a.enabled
 join public.whatsapp_attendance_senders s on s.phone=a.phone and s.user_id=a.user_id and s.enabled
 join public.profiles p on p.id=s.user_id and p.role in ('owner','manager')
 where c.singleton and c.enabled and c.phone_number_id=p_phone_id and public.whatsapp_ai_user_active(p_actor);
$$;
create function public.set_whatsapp_ai_control(p_enabled boolean,p_phone_id text default null) returns bigint language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rev bigint;
begin
 if not public.whatsapp_ai_user_active(actor) or not exists(select 1 from public.profiles where id=actor and role='owner') then raise exception 'AI_OWNER_REQUIRED' using errcode='42501';end if;
 if p_enabled is null or (p_enabled and coalesce(length(coalesce(p_phone_id,(select phone_number_id from public.whatsapp_ai_control where singleton))),0)=0) then raise exception 'AI_PHONE_MAPPING_REQUIRED';end if;
 update public.whatsapp_ai_control set enabled=p_enabled,phone_number_id=coalesce(p_phone_id,phone_number_id),revision=revision+1,updated_by=actor,updated_at=now() where singleton returning revision into rev;
 insert into public.whatsapp_ai_audit(action,actor_id) values(case when p_enabled then 'control_enabled' else 'control_disabled' end,actor);return rev;
end;$$;
create function public.set_whatsapp_ai_sender(p_phone text,p_user uuid,p_enabled boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if not public.whatsapp_ai_user_active(actor) or not exists(select 1 from public.profiles where id=actor and role='owner') then raise exception 'AI_OWNER_REQUIRED' using errcode='42501';end if;
 if p_enabled is null or (p_enabled and (not exists(select 1 from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=p_phone and s.user_id=p_user and s.enabled and p.role in ('owner','manager')) or not public.whatsapp_ai_user_active(p_user))) or (not p_enabled and not exists(select 1 from public.whatsapp_ai_senders where phone=p_phone and user_id=p_user)) then raise exception 'AI_INVALID_SENDER';end if;
 -- Serialize policy updates; existing attendance sender/permissions never change.
 perform singleton from public.whatsapp_ai_control where singleton for update;
 insert into public.whatsapp_ai_senders(phone,user_id,enabled,updated_by) values(p_phone,p_user,p_enabled,actor)
 on conflict(phone) do update set user_id=excluded.user_id,enabled=excluded.enabled,updated_by=actor,updated_at=now();
 insert into public.whatsapp_ai_audit(action,actor_id) values('allowlist_changed',actor);return true;
end;$$;
create function public.read_whatsapp_ai_admin() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();begin
 if not public.whatsapp_ai_user_active(actor) or not exists(select 1 from public.profiles where id=actor and role='owner') then raise exception 'AI_OWNER_REQUIRED' using errcode='42501';end if;
 return jsonb_build_object('control',(select to_jsonb(c) from public.whatsapp_ai_control c where singleton),'senders',coalesce((select jsonb_agg(to_jsonb(s)) from public.whatsapp_ai_senders s),'[]'::jsonb));
end;$$;

create function public.whatsapp_ai_priority_busy() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.whatsapp_attendance_inbox where report_type in ('attendance','inventory') and (status='processing' or (status='pending' and available_at<=now())))
 or exists(select 1 from public.whatsapp_attendance_decisions where status in ('processing','pending'))
 or exists(select 1 from public.whatsapp_attendance_receipts where kind<>'ai_answer' and (status='processing' or (status='pending' and available_at<=now())));
$$;
create function public.receive_whatsapp_ai(p_message_id text,p_phone text,p_phone_id text,p_text text,p_at timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare uid uuid; q public.whatsapp_attendance_inbox;
begin
 if length(p_text) not between 1 and 2000 or coalesce(length(p_phone_id),0)=0 or p_at>now()+interval '5 minutes' then return false;end if;
 select s.user_id into uid from public.whatsapp_attendance_senders s where s.phone=p_phone and public.whatsapp_ai_access(s.phone,s.user_id,p_phone_id) is not null;
 if uid is null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_phone,0));
 select * into q from public.whatsapp_attendance_inbox where provider_message_id=p_message_id;
 if q.id is not null then return true;end if;
 insert into public.whatsapp_attendance_inbox(provider_message_id,phone,actor_id,phone_number_id,message_text,message_at,status,report_type)
 values(p_message_id,p_phone,uid,p_phone_id,p_text,p_at,'review','ai_question') on conflict(provider_message_id) do nothing returning * into q;
 if q.id is null then return true;end if;
 insert into public.whatsapp_ai_tasks(inbox_id,policy_revision) values(q.id,(select revision from public.whatsapp_ai_control where singleton));
 insert into public.whatsapp_ai_audit(inbox_id,action) values(q.id,'received');return true;
end;$$;

-- Private identity check: actor/role never come from the model or caller arguments.
-- STABLE enforces read-only SQL execution inside this helper and the data RPC.
create function public.whatsapp_ai_identity(p_id uuid,p_lease uuid,p_phone_id text,p_status text) returns text
language sql stable security definer set search_path='' as $$
 select p.role from public.whatsapp_ai_tasks t join public.whatsapp_attendance_inbox q on q.id=t.inbox_id
 join public.whatsapp_attendance_senders s on s.phone=q.phone and s.user_id=q.actor_id and s.enabled
 join public.profiles p on p.id=q.actor_id and p.role=t.actor_role and p.role in ('owner','manager')
 where t.inbox_id=p_id and t.status=p_status and t.lease_token=p_lease and t.lease_until>clock_timestamp()
 and q.report_type='ai_question' and q.phone_number_id=p_phone_id
 and public.whatsapp_ai_access(q.phone,q.actor_id,p_phone_id)=p.role
 and t.policy_revision=(select revision from public.whatsapp_ai_control where singleton);
$$;

create function public.claim_whatsapp_ai(p_phone_id text,p_send boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.whatsapp_ai_tasks;q public.whatsapp_attendance_inbox;r text; keys text[];k text;blocked boolean:=false;receipt uuid;
begin
 if not exists(select 1 from public.whatsapp_ai_control where singleton and enabled and phone_number_id=p_phone_id) then return null;end if;
 if public.whatsapp_ai_priority_busy() then return null;end if;
 if not pg_try_advisory_xact_lock(340035) then return null;end if;
 if exists(select 1 from public.whatsapp_ai_tasks where status in ('processing','sending') and lease_until>now()) then return null;end if;
 -- Never automatically resend after an unacknowledged external send.
 update public.whatsapp_ai_tasks set status='delivery_unknown',error_code='DELIVERY_UNVERIFIED' where status='sending' and lease_until<now();
 update public.whatsapp_ai_tasks set status='expired',answer=null,error_code='POLICY_CHANGED' where status in ('pending','processing','ready') and policy_revision<>(select revision from public.whatsapp_ai_control where singleton);
 update public.whatsapp_attendance_receipts x set status='failed',error_code='DELIVERY_UNVERIFIED' from public.whatsapp_ai_tasks a where x.inbox_id=a.inbox_id and x.kind='ai_answer' and a.status='delivery_unknown';
 if p_send then
  select a.* into t from public.whatsapp_ai_tasks a join public.whatsapp_attendance_inbox i on i.id=a.inbox_id
   where a.status='ready' and i.phone_number_id=p_phone_id order by a.created_at for update of a skip locked limit 1;
 else
  select a.* into t from public.whatsapp_ai_tasks a join public.whatsapp_attendance_inbox i on i.id=a.inbox_id
   where (a.status='pending' or (a.status='processing' and a.lease_until<now())) and i.phone_number_id=p_phone_id
   order by a.created_at for update of a skip locked limit 1;
 end if;
 if t.inbox_id is null then return null;end if;
 select * into q from public.whatsapp_attendance_inbox where id=t.inbox_id;
 if t.policy_revision<>(select revision from public.whatsapp_ai_control where singleton) then update public.whatsapp_ai_tasks set status='expired',answer=null,error_code='POLICY_CHANGED' where inbox_id=t.inbox_id;return null;end if;
 r:=public.whatsapp_ai_access(q.phone,q.actor_id,p_phone_id);
 if r is null or (p_send and r is distinct from t.actor_role) then
  update public.whatsapp_ai_tasks set status='expired',error_code='AUTH_CHANGED',answer=null where inbox_id=t.inbox_id;
  insert into public.whatsapp_ai_audit(inbox_id,action) values(t.inbox_id,'authorization_changed');return null;
 end if;
 if q.message_at<now()-interval '23 hours 54 minutes' then update public.whatsapp_ai_tasks set status='expired',answer=null,error_code='WINDOW_CLOSED' where inbox_id=t.inbox_id;return null;end if;
 if p_send and t.expires_at<now() then
  update public.whatsapp_ai_tasks set answer='תוקף השאלה פג. שלחו שאלה חדשה לקבלת מידע עדכני.',error_code='QUESTION_EXPIRED' where inbox_id=t.inbox_id returning * into t;
 end if;
 if p_send then
  update public.whatsapp_ai_tasks set status='sending',lease_token=gen_random_uuid(),lease_until=now()+interval '30 seconds' where inbox_id=t.inbox_id returning * into t;
  insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body,message_payload,status,available_at,lease_token,lease_until,attempts)
   values(q.id,q.phone,q.message_at,'ai_answer','ai-answer:'||q.id,t.answer,jsonb_build_object('policy','readonly_ai_v1'),'processing','infinity',t.lease_token,t.lease_until,1)
   on conflict(dedupe_key) do nothing returning id into receipt;
  if receipt is null then raise exception 'AI_REPLY_ALREADY_RESERVED';end if;
  insert into public.whatsapp_ai_audit(inbox_id,action) values(t.inbox_id,'send_reserved');
  return jsonb_build_object('id',q.id,'lease_token',t.lease_token,'phone',q.phone,'answer',t.answer,'role',r,'receipt_id',receipt);
 end if;
 if t.expires_at<now() or t.attempts>=2 then
  update public.whatsapp_ai_tasks set status='ready',actor_role=r,answer='לא ניתן להשלים את השאלה כרגע. שלחו שאלה חדשה.',error_code='QUESTION_EXPIRED' where inbox_id=t.inbox_id;return null;
 end if;
 perform pg_advisory_xact_lock(340034);
 keys:=ARRAY['minute:'||q.actor_id||':'||to_char(now() at time zone 'UTC','YYYYMMDDHH24MI'),'day:'||q.actor_id||':'||to_char(now() at time zone 'UTC','YYYYMMDD'),'global:'||to_char(now() at time zone 'UTC','YYYYMMDD')];
 for k in select unnest(keys) loop
  if coalesce((select requests from public.whatsapp_ai_usage where bucket=k),0)>=(case when k like 'minute:%' then 6 when k like 'day:%' then 40 else 300 end) then blocked:=true;end if;
 end loop;
 if blocked then update public.whatsapp_ai_tasks set status='ready',actor_role=r,answer='הגעתם למכסת שאלות TAYO AI. נסו שוב מאוחר יותר.',error_code='QUOTA' where inbox_id=t.inbox_id;
  insert into public.whatsapp_ai_audit(inbox_id,action) values(t.inbox_id,'quota');return null;end if;
 delete from public.whatsapp_ai_usage where expires_at<now();
 foreach k in array keys loop insert into public.whatsapp_ai_usage values(k,1,now()+interval '2 days') on conflict(bucket) do update set requests=public.whatsapp_ai_usage.requests+1;end loop;
 update public.whatsapp_ai_tasks set status='processing',actor_role=r,attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '40 seconds' where inbox_id=t.inbox_id returning * into t;
 insert into public.whatsapp_ai_audit(inbox_id,action) values(t.inbox_id,'model_claimed');
 return jsonb_build_object('id',q.id,'lease_token',t.lease_token,'text',q.message_text,'role',r);
end;$$;

create function public.read_whatsapp_ai_snapshot(p_id uuid,p_lease uuid,p_phone_id text,p_tool text,p_args jsonb) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='3s' as $$
declare r text;start_day date;end_day date;today date:=(now() at time zone 'Asia/Jerusalem')::date;venue uuid;events jsonb;ids uuid[];assignments jsonb:='[]';movements jsonb:='[]';payments jsonb:='[]';closings jsonb:='[]';result jsonb;
begin
 r:=public.whatsapp_ai_identity(p_id,p_lease,p_phone_id,'processing');
 if r is null or p_tool not in ('operations','financial_summary','receivables','venue_closings') or (r<>'owner' and p_tool<>'operations') then raise exception 'AI_READ_FORBIDDEN' using errcode='42501';end if;
 if public.whatsapp_ai_priority_busy() then raise exception 'REPORT_PRIORITY';end if;
 if jsonb_typeof(p_args)<>'object' or exists(select 1 from jsonb_object_keys(p_args) k where k not in ('start','end','venueId')) then raise exception 'INVALID_AI_RANGE';end if;
 start_day:=(p_args->>'start')::date;end_day:=(p_args->>'end')::date;venue:=(p_args->>'venueId')::uuid;
 if start_day is null or end_day is null or start_day>end_day or end_day-start_day>366 then raise exception 'INVALID_AI_RANGE';end if;
 select coalesce(jsonb_agg(x.value),'[]'),array_agg(x.id) into events,ids from(
  select e.id,jsonb_build_object('id',e.id,'eventDate',e.event_date,'startTime',e.start_time,'eventType',e.event_type,'venueId',e.venue_id,'guestCount',e.guest_count,'packageType',e.package_type,'venue',jsonb_build_object('name',v.name))
  || case when p_tool='operations' then '{}'::jsonb else jsonb_build_object('payerType',e.payer_type,'pricePerGuest',e.price_per_guest,'vatRate',e.vat_rate,'priceIncludesVat',e.price_includes_vat,'estimatedAlcoholCost',e.estimated_alcohol_cost) end
  || case when p_tool='receivables' then jsonb_build_object('clientName',e.client_name) else '{}'::jsonb end value
  from public.events e left join public.venues v on v.id=e.venue_id
  where (venue is null or e.venue_id=venue) and
  (case when p_tool in ('receivables','venue_closings') then e.event_date<=today else e.event_date>=start_day and e.event_date<=case when p_tool='financial_summary' then least(end_day,today) else end_day end end)
  order by e.event_date,e.id limit 501)x;
 if p_tool in ('operations','financial_summary') then
  select coalesce(jsonb_agg(x.value),'[]') into assignments from(
   select jsonb_build_object('eventId',a.event_id,'eventRole',a.event_role,'workStart',a.work_start,'workEnd',a.work_end,'employee',jsonb_build_object('full_name',e.full_name))
   ||case when p_tool='financial_summary' then jsonb_build_object('payType',a.pay_type,'hourlyRate',a.hourly_rate,'fixedPay',a.fixed_pay) else '{}'::jsonb end value
   from public.event_assignments a left join public.employees e on e.id=a.employee_id where a.event_id=any(ids) order by a.id limit 501)x;
 end if;
 if p_tool='financial_summary' then
  select coalesce(jsonb_agg(x.value),'[]') into movements from(select jsonb_build_object('event_id',m.event_id,'kind',m.kind,'cost',m.total_cost_agorot::text) value from public.inventory_movements m where m.event_id=any(ids) and m.kind in ('consumption','reversal') order by m.id limit 501)x;
 end if;
 if p_tool in ('receivables','venue_closings') then
  select coalesce(jsonb_agg(x.value),'[]') into payments from(select jsonb_build_object('eventId',p.event_id,'amount',p.amount,'paidAt',p.paid_at,'paymentMethod',p.payment_method) value from public.event_payments p where p.event_id=any(ids) order by p.id limit 501)x;
  select coalesce(jsonb_agg(x.value),'[]') into closings from(select jsonb_build_object('id',c.id,'venueId',c.venue_id,'cutoffDate',c.cutoff_date,'amount',c.amount,'createdAt',c.created_at,'includesHallFee',c.includes_hall_fee,'allocations',c.allocations,'source_snapshot',c.source_snapshot) value from public.venue_settlements c where venue is null or c.venue_id=venue order by c.created_at,c.id limit 501)x;
 end if;
 result:=jsonb_build_object('events',events,'event_assignments',assignments,'inventory_movements',movements,'event_payments',payments,'venue_settlements',closings);
 if octet_length(result::text)>200000 then raise exception 'AI_RANGE_TOO_LARGE';end if;
 return result;
end;$$;

create function public.complete_whatsapp_ai(p_id uuid,p_lease uuid,p_phone_id text,p_answer text,p_code text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if public.whatsapp_ai_identity(p_id,p_lease,p_phone_id,'processing') is null then
  -- Called only after model completion/cancellation. Release this exact stale
  -- lease without saving its answer; never cancel another worker's new lease.
  update public.whatsapp_ai_tasks t set status='expired',answer=null,error_code='AI_ACCESS_REVOKED',lease_until=null
   from public.whatsapp_attendance_inbox q where t.inbox_id=p_id and q.id=t.inbox_id and q.phone_number_id=p_phone_id and t.status='processing' and t.lease_token=p_lease;
  if found then insert into public.whatsapp_ai_audit(inbox_id,action) values(p_id,'answer_discarded');end if;
  return false;
 end if;
 if public.whatsapp_ai_priority_busy() then
  update public.whatsapp_ai_tasks set status='pending',lease_until=null,error_code='REPORT_PRIORITY' where inbox_id=p_id;
  insert into public.whatsapp_ai_audit(inbox_id,action) values(p_id,'deferred_for_reports');return false;
 end if;
 if coalesce(length(trim(p_answer)),0) not between 1 and 3800 or p_code is not null and p_code not in ('AI_TIMEOUT','AI_FAILED') then raise exception 'INVALID_AI_ANSWER';end if;
 update public.whatsapp_ai_tasks set status='ready',answer=p_answer,error_code=p_code,lease_until=null where inbox_id=p_id;
 insert into public.whatsapp_ai_audit(inbox_id,action) values(p_id,case when p_code is null then 'answered' else p_code end);return true;
end;$$;

create function public.ack_whatsapp_ai(p_id uuid,p_lease uuid,p_phone_id text,p_provider text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 -- Transport ACK is not permission to send. Preserve a provider ID for a request
 -- already issued even if an operator disabled AI or revoked Auth in flight.
 if coalesce(length(p_provider),0)=0 or not exists(select 1 from public.whatsapp_ai_tasks t join public.whatsapp_attendance_inbox q on q.id=t.inbox_id where t.inbox_id=p_id and t.status='sending' and t.lease_token=p_lease and t.lease_until>clock_timestamp() and q.phone_number_id=p_phone_id and q.report_type='ai_question') then return false;end if;
 update public.whatsapp_attendance_receipts set status='sent',provider_message_id=p_provider,sent_at=now(),lease_until=null where inbox_id=p_id and kind='ai_answer' and lease_token=p_lease;
 update public.whatsapp_ai_tasks set status='sent',provider_message_id=p_provider,lease_until=null,answer=null where inbox_id=p_id;
 insert into public.whatsapp_ai_audit(inbox_id,action) values(p_id,'sent');return true;
end;$$;

create function public.fail_whatsapp_ai_delivery(p_id uuid,p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.whatsapp_ai_tasks set status='delivery_unknown',error_code='DELIVERY_UNVERIFIED',answer=null where inbox_id=p_id and status='sending' and lease_token=p_lease;
 if not found then return false;end if;
 update public.whatsapp_attendance_receipts set status='failed',error_code='DELIVERY_UNVERIFIED',lease_until=null where inbox_id=p_id and kind='ai_answer';
 insert into public.whatsapp_ai_audit(inbox_id,action) values(p_id,'delivery_unverified');return true;
end;$$;

do $$declare p record;begin
 for p in select oid::regprocedure signature,proname from pg_proc where pronamespace='public'::regnamespace and proname in ('whatsapp_ai_priority_busy','receive_whatsapp_ai','whatsapp_ai_identity','claim_whatsapp_ai','read_whatsapp_ai_snapshot','complete_whatsapp_ai','ack_whatsapp_ai','fail_whatsapp_ai_delivery','whatsapp_ai_user_active','whatsapp_ai_access','set_whatsapp_ai_control','set_whatsapp_ai_sender','read_whatsapp_ai_admin','whatsapp_ai_control_changed','whatsapp_ai_allowlist_changed') loop
  execute format('revoke all on function %s from public,anon,authenticated',p.signature);
  execute format('grant execute on function %s to service_role',p.signature);
  if p.proname in ('set_whatsapp_ai_control','set_whatsapp_ai_sender','read_whatsapp_ai_admin') then execute format('grant execute on function %s to authenticated',p.signature);end if;
  if has_function_privilege('anon',p.signature::oid,'EXECUTE') or (p.proname not in ('set_whatsapp_ai_control','set_whatsapp_ai_sender','read_whatsapp_ai_admin') and has_function_privilege('authenticated',p.signature::oid,'EXECUTE')) or exists(
   select 1 from pg_proc f cross join lateral aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
   where f.oid=p.signature::oid and a.grantee not in (f.proowner,'service_role'::regrole::oid) and not (p.proname in ('set_whatsapp_ai_control','set_whatsapp_ai_sender','read_whatsapp_ai_admin') and a.grantee='authenticated'::regrole::oid))
  then raise exception 'Unsafe 034 function privileges: %; installation must roll back',p.signature;end if;
 end loop;
end;$$;
notify pgrst,'reload schema';
commit;
