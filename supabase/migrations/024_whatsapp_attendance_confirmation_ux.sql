begin;
-- Existing employees may be assigned only inside the explicitly confirmed
-- attendance transaction. No grants or general manager permissions are added.
alter table public.whatsapp_attendance_inbox
 add column if not exists confirmation_code text,
 add column if not exists approval_result jsonb;
create unique index if not exists whatsapp_attendance_confirmation_code_idx
 on public.whatsapp_attendance_inbox(confirmation_code) where confirmation_code is not null;

create or replace function public.complete_whatsapp_attendance_analysis(p_inbox uuid,p_lease uuid,p_extracted jsonb,p_preview jsonb,p_parts jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox; token uuid; short_code text; proposal public.ai_attendance_imports; can_confirm boolean; buttons jsonb; final_text text; parts jsonb; live_role text;
begin
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
 if q.id is null or q.status<>'processing' or q.lease_token is distinct from p_lease or q.lease_until<=now() then return false; end if;
 select p.role into live_role from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id
 where s.phone=q.phone and s.user_id=q.actor_id and s.enabled and p.role in ('owner','manager') for share of s,p;
 if live_role is null then update public.whatsapp_attendance_inbox set status='rejected',error_code='SENDER_REVOKED' where id=q.id; return false; end if;
 if jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts)>100 then raise exception 'Invalid summary'; end if;
 token:=gen_random_uuid();
 -- Globally unique code, additionally scoped to the sender, business number,
 -- current token and expiry when received. A collision retries before sending.
 loop
  short_code:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  begin
   update public.whatsapp_attendance_inbox set confirmation_code=short_code where id=q.id;
   exit;
  exception when unique_violation then null;
  end;
 end loop;
 select * into proposal from public.ai_attendance_imports where id=(p_preview->>'proposalId')::uuid and actor_id=q.actor_id;
 can_confirm:=proposal.id is not null and proposal.status in ('pending','succeeded')
  and (proposal.status='succeeded' or proposal.expires_at>now())
  and jsonb_typeof(p_preview->'rows')='array' and jsonb_array_length(p_preview->'rows')>0
  and jsonb_array_length(p_preview->'issues')=0
  and not exists(select 1 from jsonb_array_elements(p_preview->'rows') r
    where jsonb_array_length(r->'issues')>0 or r->>'employeeId' is null
    or r->>'operation' not in ('update','create') or (r->>'operation'='create' and not proposal.allow_new));
 if live_role<>'owner' and coalesce((select numeric_value from public.business_settings where key='whatsapp_attendance_owner_approval_required'),1)=1 then can_confirm:=false; end if;
 update public.whatsapp_attendance_inbox set status='review',extracted=p_extracted,preview=p_preview,proposal_id=proposal.id,
 confirmation_token=token,confirmation_proposal=proposal.id,confirmation_expires_at=case when proposal.status='succeeded' then now()+interval '10 minutes' else least(coalesce(proposal.expires_at,now()+interval '10 minutes'),now()+interval '10 minutes') end,lease_until=null,error_code=null where id=q.id;
 buttons:=jsonb_build_array(jsonb_build_object('id','attendance:cancel:'||q.id||':'||token,'title','❌ בטל'));
 if can_confirm then
  final_text:=E'האם לשמור את הדיווח?\nהאישור תקף ל־10 דקות.\nאפשר גם להשיב: אשר '||short_code;
  buttons:=jsonb_build_array(jsonb_build_object('id','attendance:confirm:'||q.id||':'||token,'title','✅ אשר ושמור'))||buttons;
 elsif live_role<>'owner' and coalesce((select numeric_value from public.business_settings where key='whatsapp_attendance_owner_approval_required'),1)=1 then
  final_text:='ℹ️ לפי הגדרות העסק נדרש אישור בעלים. פנו לבעלים באפליקציה.';
 else final_text:='בדקו את הפרטים ושלחו דיווח מתוקן. לא נשמרו שעות.';
 end if;
 final_text:=final_text||E'\nלביטול: בטל '||short_code;
 -- Keep the single-worker case in one interactive message when Meta permits.
 parts:=p_parts||jsonb_build_array(final_text);
 if jsonb_array_length(p_parts)=1 and length(p_parts->>0)+length(final_text)+2<=900 then
  final_text:=(p_parts->>0)||E'\n\n'||final_text;
  parts:=jsonb_build_array(final_text);
 end if;
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body,message_payload)
 values(q.id,q.phone,q.message_at,'summary','summary:'||q.id||':'||token,final_text,jsonb_build_object('parts',parts,'buttons',buttons)) on conflict(dedupe_key) do nothing;
 return true;
end; $$;

create or replace function public.receive_whatsapp_attendance_short_decision(p_message_id text,p_phone text,p_phone_id text,p_code text,p_decision text,p_at timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox;
begin
 if p_code !~ '^[A-F0-9]{10}$' then return false; end if;
 select * into q from public.whatsapp_attendance_inbox where confirmation_code=p_code and phone=p_phone and phone_number_id=p_phone_id;
 if q.id is null then return false; end if;
 -- Do not resolve a generic yes or the latest report; only this exact code.
 -- The common intake and executor enforce live sender, token, expiry and replay.
 return public.receive_whatsapp_attendance_decision(p_message_id,p_phone,p_phone_id,q.id,q.confirmation_token,p_decision,p_at);
end; $$;

create or replace function public.approve_whatsapp_attendance(p_actor uuid,p_inbox uuid,p_proposal uuid,p_automatic boolean default false) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
declare q public.whatsapp_attendance_inbox; result jsonb; hours_text text; employee_count int; added_names jsonb; event_text text; date_text text; success_text text;
begin
 -- All WhatsApp attendance writes now require an explicit human confirmation.
 if p_automatic then return jsonb_build_object('status','forbidden'); end if;
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
 if q.id is null or not exists(select 1 from public.profiles where id=p_actor and role in ('owner','manager')) then return jsonb_build_object('status','forbidden'); end if;
 if q.status='approved' then return jsonb_build_object('status','succeeded','eventId',q.event_id,'replayed',true); end if;
 if q.status<>'review' or q.proposal_id is distinct from p_proposal then return jsonb_build_object('status','stale'); end if;
 perform s.phone from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=q.phone for share of s,p;
 if not exists(select 1 from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=q.phone and s.user_id=q.actor_id and s.enabled and p.role in ('owner','manager')) then return jsonb_build_object('status','forbidden'); end if;
 result:=public.confirm_ai_attendance(p_actor,p_proposal);
 if result->>'status'='succeeded' then
  update public.whatsapp_attendance_inbox set status='approved',approved_at=now(),reviewed_by=p_actor,event_id=(result->>'eventId')::uuid,error_code=null where id=q.id;
  select count(*),string_agg('🕒 '||e.full_name||': '||to_char((r->>'work_start')::timestamptz at time zone 'Asia/Jerusalem','HH24:MI')||'–'||to_char((r->>'work_end')::timestamptz at time zone 'Asia/Jerusalem','HH24:MI')||case when ((r->>'work_end')::timestamptz at time zone 'Asia/Jerusalem')::date>((r->>'work_start')::timestamptz at time zone 'Asia/Jerusalem')::date then ' למחרת' else '' end,E'\n' order by e.full_name) into employee_count,hours_text
   from public.ai_attendance_imports i cross join lateral jsonb_array_elements(i.payload) r join public.employees e on e.id=(r->>'employee_id')::uuid where i.id=p_proposal;
  select coalesce(jsonb_agg(e.full_name order by e.full_name),'[]'::jsonb) into added_names
   from public.ai_attendance_audit a join public.event_assignments s on s.id=a.assignment_id join public.employees e on e.id=s.employee_id
   where a.import_id=p_proposal and a.before_values is null;
  select coalesce(v.name,'אירוע')||' — '||coalesce(e.client_name,''),to_char(e.event_date,'DD.MM.YYYY') into event_text,date_text
   from public.events e left join public.venues v on v.id=e.venue_id where e.id=(result->>'eventId')::uuid;
  result:=result||jsonb_build_object('addedEmployeeNames',added_names,'employeeCount',employee_count);
  update public.whatsapp_attendance_inbox set approval_result=result where id=q.id;
  success_text:=case when result->>'replayed'='true' then E'✅ הדיווח כבר נשמר. לא בוצע עדכון נוסף.\n\n📍 ' else E'✅ הדיווח נשמר בהצלחה!\n\n📍 ' end||event_text||E'\n📅 '||date_text||E'\n\n👥 '||case when employee_count=1 then 'עובד אחד עודכן' else employee_count||' עובדים עודכנו' end||E'\n'||coalesce(hours_text,'');
  if jsonb_array_length(added_names)>0 then success_text:=success_text||E'\nℹ️ נוספו לשיבוץ האירוע: '||(select string_agg(value,', ') from jsonb_array_elements_text(added_names)); end if;
  insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
   values(q.id,q.phone,q.message_at,'result','result:'||q.id,success_text) on conflict(dedupe_key) do nothing;
  insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(p_actor,q.id,'approved');
 end if;
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
  decision_result:=jsonb_build_object('status','forbidden'); feedback:='⚠️ ההרשאה לדיווח אינה פעילה. פנו לבעלים.';
 elsif q.status='approved' then decision_result:=jsonb_build_object('status','succeeded','replayed',true); feedback:='✅ הדיווח כבר נשמר. לא בוצע עדכון נוסף. לשינוי השעות פתחו את האירוע באפליקציה.';
 elsif q.status='rejected' then decision_result:=jsonb_build_object('status','cancelled'); feedback:='❌ הדיווח בוטל. לא נשמרו שעות.';
 elsif q.confirmation_token is distinct from d.token or q.confirmation_expires_at<=now() or q.status<>'review' then
  decision_result:=jsonb_build_object('status','expired'); feedback:='⚠️ תוקף האישור פג או שהדיווח השתנה. שלחו שוב את הדיווח לבדיקה.';
 elsif d.decision='cancel' then
  perform public.review_whatsapp_attendance(d.actor_id,q.id,'reject');
  decision_result:=jsonb_build_object('status','cancelled'); feedback:='❌ הדיווח בוטל. לא נשמרו שעות.';
 elsif role_name<>'owner' and coalesce((select numeric_value from public.business_settings where key='whatsapp_attendance_owner_approval_required'),0)=1 then
  decision_result:=jsonb_build_object('status','forbidden'); feedback:='ℹ️ לפי הגדרות העסק נדרש אישור בעלים. פנו לבעלים באפליקציה.';
 elsif q.proposal_id is null or q.confirmation_proposal is distinct from q.proposal_id
  or coalesce(jsonb_array_length(q.preview->'issues'),1)>0
  or coalesce(jsonb_array_length(q.preview->'rows'),0)=0
  or exists(select 1 from jsonb_array_elements(q.preview->'rows') r where r->>'employeeId' is null or jsonb_array_length(r->'issues')>0) then
  decision_result:=jsonb_build_object('status','needs_correction'); feedback:='⚠️ לא ניתן לשמור את הדיווח. בדקו את השמות והשעות ושלחו דיווח מתוקן.';
 else
  begin decision_result:=public.approve_whatsapp_attendance(d.actor_id,q.id,q.proposal_id,false);
  exception when others then decision_result:=jsonb_build_object('status','failed'); end;
  if decision_result->>'status'='succeeded' then
   update public.whatsapp_attendance_receipts set message_at=greatest(message_at,d.message_at) where inbox_id=q.id and kind='result';
  else
   feedback:='⚠️ לא ניתן לשמור את הדיווח. '||case decision_result->>'status' when 'stale' then 'השעות או השיבוץ השתנו מאז הסיכום. שלחו שוב את הדיווח לבדיקה.' when 'expired' then 'תוקף האישור פג. שלחו שוב את הדיווח.' when 'forbidden' then 'אין הרשאה לאישור זה. פנו לבעלים.' else 'השמירה נכשלה. לא נשמרו שעות או שיבוצים חלקיים. נסו שוב או פנו לבעלים.' end;
   update public.whatsapp_attendance_inbox set status='failed',error_code='WHATSAPP_CONFIRMATION_'||upper(decision_result->>'status') where id=q.id and status='review';
  end if;
 end if;
 if feedback is not null then
  insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
  values(q.id,d.phone,d.message_at,'feedback','decision:'||d.id,feedback) on conflict(dedupe_key) do nothing;
 end if;
 update public.whatsapp_attendance_decisions set status='done',result=decision_result,lease_until=null where id=d.id;
 insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(d.actor_id,q.id,'whatsapp_'||d.decision||'_'||(decision_result->>'status'));
 return decision_result;
end; $$;

create or replace function public.claim_whatsapp_attendance_decision() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 update public.whatsapp_attendance_decisions set status='failed' where status='processing' and lease_until<now() and attempts>=5;
 update public.whatsapp_attendance_inbox q set status='failed',error_code='WHATSAPP_CONFIRMATION_UNVERIFIED'
 where q.status='review' and exists(select 1 from public.whatsapp_attendance_decisions d where d.inbox_id=q.id and d.token=q.confirmation_token and d.status='failed');
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
 select d.inbox_id,d.phone,d.message_at,'feedback','unverified-decision:'||d.id,'⚠️ לא ניתן לוודא אם הדיווח נשמר. בדקו את מצבו באפליקציה לפני ניסיון נוסף.'
 from public.whatsapp_attendance_decisions d where d.status='failed' on conflict(dedupe_key) do nothing;
 with candidate as(select id from public.whatsapp_attendance_decisions where attempts<5 and (status='pending' or(status='processing' and lease_until<now())) order by received_at for update skip locked limit 1)
 update public.whatsapp_attendance_decisions d set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' from candidate c where d.id=c.id returning to_jsonb(d) into result;
 return result;
end; $$;

create or replace function public.queue_whatsapp_attendance_failure(p_inbox uuid,p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox;
begin
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox;
 if q.status<>'failed' or q.lease_token is distinct from p_lease then return false; end if;
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
 values(q.id,q.phone,q.message_at,'failure','failure:'||q.id||':'||p_lease,'⚠️ לא הצלחתי לבדוק את הדיווח. בדקו את האולם, התאריך, השמות והשעות ושלחו שוב. לא נשמרו שעות.') on conflict(dedupe_key) do nothing;
 return true;
end; $$;

revoke all on function public.receive_whatsapp_attendance_short_decision(text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.receive_whatsapp_attendance_short_decision(text,text,text,text,text,timestamptz) to service_role;
-- CREATE OR REPLACE preserves existing private ACLs on all other functions.
notify pgrst,'reload schema';
commit;

