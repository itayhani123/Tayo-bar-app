begin;
create table public.whatsapp_attendance_senders (
 phone text primary key check(phone ~ '^[1-9][0-9]{7,14}$'), user_id uuid not null references auth.users(id),
 enabled boolean not null default true, auto_save boolean not null default false,
 updated_by uuid not null references auth.users(id), updated_at timestamptz not null default now()
);
create table public.whatsapp_attendance_inbox (
 id uuid primary key default gen_random_uuid(), provider_message_id text not null unique,
 phone text not null, actor_id uuid not null references auth.users(id), phone_number_id text not null,
 message_text text not null check(length(message_text) between 1 and 12000), message_at timestamptz not null,
 received_at timestamptz not null default now(), status text not null default 'pending'
 check(status in ('pending','processing','review','approved','failed','rejected')),
 attempts int not null default 0, available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
 extracted jsonb, preview jsonb, proposal_id uuid references public.ai_attendance_imports(id),
 reviewed_by uuid references auth.users(id), approved_at timestamptz, event_id uuid references public.events(id), error_code text
);
create table public.whatsapp_attendance_receipts (
 id uuid primary key default gen_random_uuid(), inbox_id uuid not null unique references public.whatsapp_attendance_inbox(id),
 phone text not null, message_at timestamptz not null, status text not null default 'pending'
 check(status in ('pending','processing','sent','delivered','read','failed','expired')),
 attempts int not null default 0, available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
 provider_message_id text, error_code text, sent_at timestamptz
);
create index on public.whatsapp_attendance_inbox(status,available_at);
create index on public.whatsapp_attendance_receipts(status,available_at);
create table public.whatsapp_attendance_audit (
 id bigint generated always as identity primary key, actor_id uuid references auth.users(id),
 inbox_id uuid references public.whatsapp_attendance_inbox(id), action text not null, occurred_at timestamptz not null default now()
);
alter table public.whatsapp_attendance_senders enable row level security;
alter table public.whatsapp_attendance_inbox enable row level security;
alter table public.whatsapp_attendance_receipts enable row level security;
alter table public.whatsapp_attendance_audit enable row level security;
revoke all on public.whatsapp_attendance_senders,public.whatsapp_attendance_inbox,public.whatsapp_attendance_receipts,public.whatsapp_attendance_audit from public,anon,authenticated;
grant all on public.whatsapp_attendance_senders,public.whatsapp_attendance_inbox,public.whatsapp_attendance_receipts to service_role;
grant select,insert on public.whatsapp_attendance_audit to service_role;
grant usage,select on sequence public.whatsapp_attendance_audit_id_seq to service_role;

create function public.receive_whatsapp_attendance(p_message_id text,p_phone text,p_phone_id text,p_text text,p_at timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare uid uuid;
begin
 select s.user_id into uid from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=p_phone and s.enabled and p.role in ('owner','manager');
 if uid is null then return false; end if;
 -- Per-sender durable cost cap. Duplicate deliveries are acknowledged even at the cap.
 perform pg_advisory_xact_lock(hashtextextended(p_phone,0));
 if exists(select 1 from public.whatsapp_attendance_inbox where provider_message_id=p_message_id) then return true; end if;
 if (select count(*) from public.whatsapp_attendance_inbox where phone=p_phone and received_at>now()-interval '1 hour')>=30 then raise exception 'Sender rate limit; retry delivery later'; end if;
 insert into public.whatsapp_attendance_inbox(provider_message_id,phone,actor_id,phone_number_id,message_text,message_at) values(p_message_id,p_phone,uid,p_phone_id,p_text,p_at) on conflict(provider_message_id) do nothing;
 return true;
end; $$;
create function public.review_whatsapp_attendance(p_actor uuid,p_inbox uuid,p_action text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed boolean;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role in ('owner','manager')) then raise exception 'Unauthorized' using errcode='42501'; end if;
 if p_action='reject' then
  update public.whatsapp_attendance_inbox set status='rejected',reviewed_by=p_actor where id=p_inbox and status in ('review','failed','pending'); changed:=found;
 elsif p_action='retry' then
  update public.whatsapp_attendance_inbox set status='pending',attempts=0,error_code=null,available_at=now() where id=p_inbox and status='failed'; changed:=found;
 elsif p_action='retryReceipt' then
  update public.whatsapp_attendance_receipts set status='pending',attempts=0,error_code=null,available_at=now() where inbox_id=p_inbox and status in ('failed','expired') and exists(select 1 from public.whatsapp_attendance_inbox where id=p_inbox and status='approved'); changed:=found;
 else raise exception 'Invalid action'; end if;
 if changed then insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(p_actor,p_inbox,p_action); end if;
 return changed;
end; $$;
create function public.claim_whatsapp_attendance(p_receipt boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_receipt then
  update public.whatsapp_attendance_receipts set status='failed',error_code='LEASE_ATTEMPTS_EXHAUSTED' where status='processing' and lease_until<now() and attempts>=5;
 else
  update public.whatsapp_attendance_inbox set status='failed',error_code='LEASE_ATTEMPTS_EXHAUSTED' where status='processing' and lease_until<now() and attempts>=5;
 end if;
 if p_receipt then
  with candidate as (select id from public.whatsapp_attendance_receipts where attempts<5 and ((status='pending' and available_at<=now()) or (status='processing' and lease_until<now())) order by available_at for update skip locked limit 1)
  update public.whatsapp_attendance_receipts q set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' from candidate c where q.id=c.id returning to_jsonb(q) into result;
 else
  with candidate as (select id from public.whatsapp_attendance_inbox where attempts<5 and ((status='pending' and available_at<=now()) or (status='processing' and lease_until<now())) order by received_at for update skip locked limit 1)
  update public.whatsapp_attendance_inbox q set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' from candidate c where q.id=c.id returning to_jsonb(q) into result;
 end if;
 return result;
end; $$;
create function public.configure_whatsapp_attendance_sender(p_actor uuid,p_phone text,p_user uuid,p_enabled boolean,p_auto boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='owner') or not exists(select 1 from public.profiles where id=p_user and role in ('owner','manager')) then raise exception 'Unauthorized' using errcode='42501'; end if;
 insert into public.whatsapp_attendance_senders(phone,user_id,enabled,auto_save,updated_by) values(p_phone,p_user,p_enabled,p_auto,p_actor)
 on conflict(phone) do update set user_id=excluded.user_id,enabled=excluded.enabled,auto_save=excluded.auto_save,updated_by=p_actor,updated_at=now();
 insert into public.whatsapp_attendance_audit(actor_id,action) values(p_actor,'sender_configuration_updated');
end; $$;
create function public.approve_whatsapp_attendance(p_actor uuid,p_inbox uuid,p_proposal uuid,p_automatic boolean default false) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare q public.whatsapp_attendance_inbox; result jsonb;
begin
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
 if q.id is null or not exists(select 1 from public.profiles where id=p_actor and role in ('owner','manager')) then return jsonb_build_object('status','forbidden'); end if;
 if q.status='approved' then return jsonb_build_object('status','succeeded','eventId',q.event_id,'replayed',true); end if;
 if q.status<>'review' or q.proposal_id is distinct from p_proposal then return jsonb_build_object('status','stale'); end if;
 perform s.phone from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=q.phone for share of s,p;
 if not exists(select 1 from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=q.phone and s.user_id=q.actor_id and s.enabled and p.role in ('owner','manager')) then return jsonb_build_object('status','forbidden'); end if;
 if p_automatic and (p_actor<>q.actor_id or not exists(select 1 from public.whatsapp_attendance_senders where phone=q.phone and auto_save and enabled) or exists(
  select 1 from public.ai_attendance_imports i, jsonb_array_elements(i.payload) r where i.id=p_proposal and not exists(select 1 from public.event_assignments a where a.event_id=i.event_id and a.employee_id=(r->>'employee_id')::uuid and a.work_start is null and a.work_end is null)
 )) then return jsonb_build_object('status','forbidden'); end if;
 result := public.confirm_ai_attendance(p_actor,p_proposal);
 if result->>'status'='succeeded' then
  update public.whatsapp_attendance_inbox set status='approved',approved_at=now(),reviewed_by=p_actor,event_id=(result->>'eventId')::uuid where id=q.id;
  insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at) values(q.id,q.phone,q.message_at) on conflict(inbox_id) do nothing;
  insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(p_actor,q.id,'approved');
 end if;
 return result;
end; $$;
revoke all on function public.receive_whatsapp_attendance(text,text,text,text,timestamptz),public.claim_whatsapp_attendance(boolean),public.approve_whatsapp_attendance(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.receive_whatsapp_attendance(text,text,text,text,timestamptz),public.claim_whatsapp_attendance(boolean),public.approve_whatsapp_attendance(uuid,uuid,uuid,boolean) to service_role;
revoke all on function public.configure_whatsapp_attendance_sender(uuid,text,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function public.configure_whatsapp_attendance_sender(uuid,text,uuid,boolean,boolean) to service_role;
revoke all on function public.review_whatsapp_attendance(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_whatsapp_attendance(uuid,uuid,text) to service_role;
commit;
