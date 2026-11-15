begin;
do $$ begin
 if to_regprocedure('public.confirm_ai_attendance(uuid,uuid)') is null
 or to_regprocedure('public.review_whatsapp_attendance(uuid,uuid,text)') is null then
  raise exception 'Apply attendance migrations 019, 020 and 021 before 022';
 end if;
end; $$;
alter table public.whatsapp_attendance_inbox
 add column if not exists confirmation_token uuid,
 add column if not exists confirmation_proposal uuid references public.ai_attendance_imports(id),
 add column if not exists confirmation_expires_at timestamptz;
alter table public.whatsapp_attendance_receipts
 add column if not exists kind text not null default 'result',
 add column if not exists dedupe_key text,
 add column if not exists body text,
 add column if not exists message_payload jsonb,
 add column if not exists part_index int not null default 0;
update public.whatsapp_attendance_receipts set dedupe_key='result:'||inbox_id::text where dedupe_key is null;
alter table public.whatsapp_attendance_receipts alter column dedupe_key set default gen_random_uuid()::text;
alter table public.whatsapp_attendance_receipts alter column dedupe_key set not null;
-- A report now has a summary and a result, each with its own durable deduplication key.
alter table public.whatsapp_attendance_receipts drop constraint if exists whatsapp_attendance_receipts_inbox_id_key;
create unique index if not exists whatsapp_attendance_receipts_dedupe_idx on public.whatsapp_attendance_receipts(dedupe_key);
create table if not exists public.whatsapp_attendance_decisions (
 id uuid primary key default gen_random_uuid(), provider_message_id text not null unique,
 inbox_id uuid not null references public.whatsapp_attendance_inbox(id), phone text not null,
 actor_id uuid not null references auth.users(id), decision text not null check(decision in ('confirm','cancel')),
 token uuid not null, message_at timestamptz not null, received_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','processing','done','failed')),
 attempts int not null default 0, lease_token uuid, lease_until timestamptz, result jsonb
);
alter table public.whatsapp_attendance_decisions enable row level security;
revoke all on public.whatsapp_attendance_decisions from public,anon,authenticated;
grant select,insert,update on public.whatsapp_attendance_decisions to service_role;
create index if not exists whatsapp_attendance_decisions_status_idx on public.whatsapp_attendance_decisions(status,received_at);
insert into public.business_settings(key,numeric_value) values('whatsapp_attendance_owner_approval_required',0) on conflict(key) do nothing;
-- The older broad settings policy must not let a manager lower this approval requirement.
alter table public.business_settings enable row level security;
drop policy if exists "Owner controls WhatsApp attendance approval policy" on public.business_settings;
create policy "Owner controls WhatsApp attendance approval policy" on public.business_settings as restrictive for all to authenticated
 using(key<>'whatsapp_attendance_owner_approval_required' or exists(select 1 from public.profiles where id=auth.uid() and role='owner'))
 with check(key<>'whatsapp_attendance_owner_approval_required' or exists(select 1 from public.profiles where id=auth.uid() and role='owner'));
revoke truncate on public.business_settings from anon,authenticated;

create or replace function public.complete_whatsapp_attendance_analysis(p_inbox uuid,p_lease uuid,p_extracted jsonb,p_preview jsonb,p_parts jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox; token uuid; proposal public.ai_attendance_imports; can_confirm boolean; buttons jsonb; final_text text; parts jsonb; live_role text;
begin
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
 if q.id is null or q.status<>'processing' or q.lease_token is distinct from p_lease or q.lease_until<=now() then return false; end if;
 select p.role into live_role from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id
 where s.phone=q.phone and s.user_id=q.actor_id and s.enabled and p.role in ('owner','manager') for share of s,p;
 if live_role is null then update public.whatsapp_attendance_inbox set status='rejected',error_code='SENDER_REVOKED' where id=q.id; return false; end if;
 if jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts)>100 then raise exception 'Invalid summary'; end if;
 token:=gen_random_uuid();
 select * into proposal from public.ai_attendance_imports where id=(p_preview->>'proposalId')::uuid and actor_id=q.actor_id;
 can_confirm:=proposal.id is not null and not proposal.allow_new and proposal.status in ('pending','succeeded')
  and (proposal.status='succeeded' or proposal.expires_at>now()) and jsonb_array_length(p_preview->'issues')=0
  and not exists(select 1 from jsonb_array_elements(p_preview->'rows') r where jsonb_array_length(r->'issues')>0 or r->>'operation'<>'update');
 if live_role<>'owner' and coalesce((select numeric_value from public.business_settings where key='whatsapp_attendance_owner_approval_required'),0)=1 then can_confirm:=false; end if;
 update public.whatsapp_attendance_inbox set status='review',extracted=p_extracted,preview=p_preview,proposal_id=proposal.id,
 confirmation_token=token,confirmation_proposal=proposal.id,confirmation_expires_at=case when proposal.status='succeeded' then now()+interval '10 minutes' else least(coalesce(proposal.expires_at,now()+interval '10 minutes'),now()+interval '10 minutes') end,lease_until=null,error_code=null where id=q.id;
 final_text:='דיווח '||q.id::text||E'\nהאישור מתייחס רק לסיכום שנשלח כעת, ותוקפו עד 10 דקות.\n';
 buttons:=jsonb_build_array(jsonb_build_object('id','attendance:cancel:'||q.id||':'||token,'title','בטל דיווח'));
 if can_confirm then
  final_text:=final_text||E'לאישור בטקסט:\nאשר '||q.id||' '||token||E'\n';
  buttons:=jsonb_build_array(jsonb_build_object('id','attendance:confirm:'||q.id||':'||token,'title','אשר דיווח'))||buttons;
 else final_text:=final_text||E'לא ניתן לאשר בוואטסאפ: יש לתקן חוסרים או עמימות באפליקציה, או לפנות לבעלים אם נדרשת הרשאתו.\n'; end if;
 final_text:=final_text||E'לביטול בטקסט:\nבטל '||q.id||' '||token;
 parts:=p_parts||jsonb_build_array(final_text);
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body,message_payload)
 values(q.id,q.phone,q.message_at,'summary','summary:'||q.id||':'||token,final_text,jsonb_build_object('parts',parts,'buttons',buttons)) on conflict(dedupe_key) do nothing;
 return true;
end; $$;

-- Replace the legacy 3-argument overload only; the defaulted canonical signature preserves its callers.
-- No CASCADE: unknown dependencies abort the migration rather than being removed.
drop function if exists public.approve_whatsapp_attendance(uuid,uuid,uuid);
create or replace function public.approve_whatsapp_attendance(p_actor uuid,p_inbox uuid,p_proposal uuid,p_automatic boolean default false) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare q public.whatsapp_attendance_inbox; result jsonb; names text; employee_count int;
begin
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
 if q.id is null or not exists(select 1 from public.profiles where id=p_actor and role in ('owner','manager')) then return jsonb_build_object('status','forbidden'); end if;
 if q.status='approved' then return jsonb_build_object('status','succeeded','eventId',q.event_id,'replayed',true); end if;
 if q.status<>'review' or q.proposal_id is distinct from p_proposal then return jsonb_build_object('status','stale'); end if;
 perform s.phone from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=q.phone for share of s,p;
 if not exists(select 1 from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=q.phone and s.user_id=q.actor_id and s.enabled and p.role in ('owner','manager')) then return jsonb_build_object('status','forbidden'); end if;
 if p_automatic and (p_actor<>q.actor_id or not exists(select 1 from public.whatsapp_attendance_senders where phone=q.phone and auto_save and enabled) or exists(
  select 1 from public.ai_attendance_imports i,jsonb_array_elements(i.payload) r where i.id=p_proposal and not exists(select 1 from public.event_assignments a where a.event_id=i.event_id and a.employee_id=(r->>'employee_id')::uuid and a.work_start is null and a.work_end is null)
 )) then return jsonb_build_object('status','forbidden'); end if;
 if p_automatic and coalesce((select numeric_value from public.business_settings where key='whatsapp_attendance_owner_approval_required'),1)=1
 and not exists(select 1 from public.profiles where id=p_actor and role='owner') then return jsonb_build_object('status','forbidden'); end if;
 result:=public.confirm_ai_attendance(p_actor,p_proposal);
 if result->>'status'='succeeded' then
  update public.whatsapp_attendance_inbox set status='approved',approved_at=now(),reviewed_by=p_actor,event_id=(result->>'eventId')::uuid,error_code=null where id=q.id;
  select count(*),string_agg(e.full_name,', ' order by e.full_name) into employee_count,names
   from public.ai_attendance_imports i cross join lateral jsonb_array_elements(i.payload) r join public.employees e on e.id=(r->>'employee_id')::uuid where i.id=p_proposal;
  insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
   values(q.id,q.phone,q.message_at,'result','result:'||q.id,'דיווח '||q.id||E'\nכל השעות נשמרו בהצלחה. מספר עובדים: '||employee_count||E'\n'||coalesce(names,'')) on conflict(dedupe_key) do nothing;
  insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(p_actor,q.id,'approved');
 end if;
 return result;
end; $$;

create or replace function public.receive_whatsapp_attendance_decision(p_message_id text,p_phone text,p_phone_id text,p_inbox uuid,p_token uuid,p_decision text,p_at timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox; uid uuid;
begin
 if p_decision not in ('confirm','cancel') then return false; end if;
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox;
 select s.user_id into uid from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=p_phone and s.enabled and p.role in ('owner','manager');
 if q.id is null or uid is null or q.phone<>p_phone or q.phone_number_id<>p_phone_id or q.actor_id<>uid or q.confirmation_token is distinct from p_token or p_at<q.message_at then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_phone,0));
 if exists(select 1 from public.whatsapp_attendance_decisions where provider_message_id=p_message_id) then return true; end if;
 if (select count(*) from public.whatsapp_attendance_decisions where phone=p_phone and received_at>now()-interval '1 hour')>=60 then raise exception 'Decision rate limit'; end if;
 insert into public.whatsapp_attendance_decisions(provider_message_id,inbox_id,phone,actor_id,decision,token,message_at) values(p_message_id,q.id,p_phone,uid,p_decision,p_token,p_at) on conflict(provider_message_id) do nothing;
 return true;
end; $$;
create or replace function public.claim_whatsapp_attendance_decision() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 update public.whatsapp_attendance_decisions set status='failed' where status='processing' and lease_until<now() and attempts>=5;
 update public.whatsapp_attendance_inbox q set status='failed',error_code='WHATSAPP_CONFIRMATION_UNVERIFIED'
 where q.status='review' and exists(select 1 from public.whatsapp_attendance_decisions d where d.inbox_id=q.id and d.token=q.confirmation_token and d.status='failed');
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
 select d.inbox_id,d.phone,d.message_at,'feedback','unverified-decision:'||d.id,'הטיפול בתגובה לא הושלם. בדקו את מצב הדיווח באפליקציה לפני ניסיון אישור נוסף; אין להסיק שלא נשמר'
 from public.whatsapp_attendance_decisions d where d.status='failed' on conflict(dedupe_key) do nothing;
 with candidate as(select id from public.whatsapp_attendance_decisions where attempts<5 and (status='pending' or(status='processing' and lease_until<now())) order by received_at for update skip locked limit 1)
 update public.whatsapp_attendance_decisions d set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' from candidate c where d.id=c.id returning to_jsonb(d) into result;
 return result;
end; $$;
create or replace function public.execute_whatsapp_attendance_decision(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $$
declare d public.whatsapp_attendance_decisions; q public.whatsapp_attendance_inbox; role_name text; decision_result jsonb; feedback text;
begin
 select * into d from public.whatsapp_attendance_decisions where id=p_id for update;
 if d.id is null or d.lease_token is distinct from p_lease then return jsonb_build_object('status','stale'); end if;
 if d.status='done' then return d.result; end if;
 if d.status<>'processing' or d.lease_until<=now() then return jsonb_build_object('status','stale'); end if;
 select * into q from public.whatsapp_attendance_inbox where id=d.inbox_id for update;
 select p.role into role_name from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=d.phone and s.user_id=d.actor_id and s.enabled for share of s,p;
 if role_name is null or role_name not in ('owner','manager') or q.actor_id<>d.actor_id or q.phone<>d.phone then
  decision_result:=jsonb_build_object('status','forbidden'); feedback:='ההרשאה לדיווח אינה פעילה. פנו לבעלים';
 elsif q.status='approved' then decision_result:=jsonb_build_object('status','succeeded','replayed',true); feedback:='הדיווח כבר נשמר. לא בוצעה שמירה נוספת ולא ניתן לבטל את השעות דרך הודעת ביטול';
 elsif q.status='rejected' then decision_result:=jsonb_build_object('status','cancelled'); feedback:='הדיווח בוטל. לא נשמרו שעות';
 elsif q.confirmation_token is distinct from d.token or q.confirmation_expires_at<=now() or q.status<>'review' then
  decision_result:=jsonb_build_object('status','expired'); feedback:='האישור פג או שהדיווח השתנה. לא נשמרו שעות; שלחו דיווח מתוקן או בדקו אותו באפליקציה';
 elsif d.decision='cancel' then
  perform public.review_whatsapp_attendance(d.actor_id,q.id,'reject');
  decision_result:=jsonb_build_object('status','cancelled'); feedback:='הדיווח בוטל. לא נשמרו שעות';
 elsif role_name<>'owner' and coalesce((select numeric_value from public.business_settings where key='whatsapp_attendance_owner_approval_required'),0)=1 then
  decision_result:=jsonb_build_object('status','forbidden'); feedback:='אישור דיווח בוואטסאפ דורש הרשאת בעלים לפי הגדרות העסק. יש לפנות לבעלים באפליקציה';
 elsif q.proposal_id is null or q.confirmation_proposal is distinct from q.proposal_id or exists(select 1 from public.ai_attendance_imports where id=q.proposal_id and allow_new) then
  decision_result:=jsonb_build_object('status','needs_correction'); feedback:='הדיווח חסר, השתנה או דורש שיבוץ נפרד. לא נשמרו שעות. תקנו ואשרו באפליקציה';
 else
  begin decision_result:=public.approve_whatsapp_attendance(d.actor_id,q.id,q.proposal_id,false);
  exception when others then decision_result:=jsonb_build_object('status','failed'); end;
  if decision_result->>'status'='succeeded' then
   update public.whatsapp_attendance_receipts set message_at=greatest(message_at,d.message_at) where inbox_id=q.id and kind='result';
  else
   feedback:=case decision_result->>'status' when 'stale' then 'הנתונים השתנו מאז הסיכום' when 'expired' then 'תוקף תצוגת השעות פג' when 'forbidden' then 'אין הרשאה לאישור זה' else 'שמירת השעות נכשלה; לא נשמרה רשימה חלקית' end||'. בדקו ותקנו באפליקציה או שלחו דיווח חדש';
   update public.whatsapp_attendance_inbox set status='failed',error_code='WHATSAPP_CONFIRMATION_'||upper(decision_result->>'status') where id=q.id and status='review';
  end if;
 end if;
 if feedback is not null then
  insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
  values(q.id,d.phone,d.message_at,'feedback','decision:'||d.id,'דיווח '||q.id||E'\n'||feedback) on conflict(dedupe_key) do nothing;
 end if;
 update public.whatsapp_attendance_decisions set status='done',result=decision_result,lease_until=null where id=d.id;
 insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(d.actor_id,q.id,'whatsapp_'||d.decision||'_'||(decision_result->>'status'));
 return decision_result;
end; $$;

create or replace function public.whatsapp_attendance_service_window(p_phone text) returns timestamptz
language sql stable security invoker set search_path='' as $$
 select greatest((select max(message_at) from public.whatsapp_attendance_inbox where phone=p_phone),
  (select max(message_at) from public.whatsapp_attendance_decisions where phone=p_phone));
$$;

create or replace function public.queue_whatsapp_attendance_failure(p_inbox uuid,p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox;
begin
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox;
 if q.status<>'failed' or q.lease_token is distinct from p_lease then return false; end if;
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
 values(q.id,q.phone,q.message_at,'failure','failure:'||q.id||':'||p_lease,'דיווח '||q.id||E'\nלא ניתן לפענח או לבדוק את הדיווח לאחר ניסיונות חוזרים. לא נשמרו שעות ממסלול הפענוח. בדקו אולם, תאריך ושמות ושלחו שוב, או פתחו את הדיווח באפליקציה') on conflict(dedupe_key) do nothing;
 return true;
end; $$;
create or replace function public.whatsapp_attendance_failure_outbox() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='failed' and new.error_code in ('PROCESSING_FAILED','LEASE_ATTEMPTS_EXHAUSTED') and old.status is distinct from new.status then
  perform public.queue_whatsapp_attendance_failure(new.id,new.lease_token);
 end if;
 return new;
end; $$;
drop trigger if exists whatsapp_attendance_failure_outbox on public.whatsapp_attendance_inbox;
create trigger whatsapp_attendance_failure_outbox after update of status on public.whatsapp_attendance_inbox for each row execute function public.whatsapp_attendance_failure_outbox();

revoke all on function public.complete_whatsapp_attendance_analysis(uuid,uuid,jsonb,jsonb,jsonb), public.receive_whatsapp_attendance_decision(text,text,text,uuid,uuid,text,timestamptz),public.claim_whatsapp_attendance_decision(),public.execute_whatsapp_attendance_decision(uuid,uuid),public.approve_whatsapp_attendance(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.complete_whatsapp_attendance_analysis(uuid,uuid,jsonb,jsonb,jsonb), public.receive_whatsapp_attendance_decision(text,text,text,uuid,uuid,text,timestamptz),public.claim_whatsapp_attendance_decision(),public.execute_whatsapp_attendance_decision(uuid,uuid),public.approve_whatsapp_attendance(uuid,uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
revoke all on function public.queue_whatsapp_attendance_failure(uuid,uuid),public.whatsapp_attendance_failure_outbox() from public,anon,authenticated;
grant execute on function public.queue_whatsapp_attendance_failure(uuid,uuid),public.whatsapp_attendance_failure_outbox() to service_role;
grant select on public.business_settings to service_role;
revoke all on function public.whatsapp_attendance_service_window(text) from public,anon,authenticated;
grant execute on function public.whatsapp_attendance_service_window(text) to service_role;
commit;
