begin;
alter table public.whatsapp_attendance_decisions add column if not exists source_type text, add column if not exists reply_context_message_id text;
create or replace function public.complete_whatsapp_attendance_analysis(p_inbox uuid,p_lease uuid,p_extracted jsonb,p_preview jsonb,p_parts jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox; token uuid; proposal public.ai_attendance_imports; can_confirm boolean; buttons jsonb; final_text text; parts jsonb; live_role text;
begin
 if p_preview->>'confirmationPolicy' is distinct from 'buttons_attendance_v2' then raise exception 'WHATSAPP_WORKER_VERSION_MISMATCH' using errcode='22023'; end if;
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
 if q.id is null or q.status<>'processing' or q.lease_token is distinct from p_lease or q.lease_until<=now() then return false; end if;
 select p.role into live_role from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id
 where s.phone=q.phone and s.user_id=q.actor_id and s.enabled and p.role in ('owner','manager') for share of s,p;
 if live_role is null then update public.whatsapp_attendance_inbox set status='rejected',error_code='SENDER_REVOKED' where id=q.id; return false; end if;
 if jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts)>100 then raise exception 'Invalid summary'; end if;
 token:=gen_random_uuid();
 select * into proposal from public.ai_attendance_imports where id=(p_preview->>'proposalId')::uuid and actor_id=q.actor_id;
 can_confirm:=proposal.id is not null and proposal.status in ('pending','succeeded')
  and (proposal.status='succeeded' or proposal.expires_at>now())
  and jsonb_typeof(p_preview->'rows')='array' and jsonb_array_length(p_preview->'rows')>0
  and jsonb_array_length(p_preview->'issues')=0
  and not exists(select 1 from jsonb_array_elements(p_preview->'rows') r
    where jsonb_array_length(r->'issues')>0 or r->>'employeeId' is null
    or r->>'operation' not in ('update','create')
    or (r->>'operation'='create' and (not proposal.allow_new or r->>'needs_auto_assignment' is distinct from 'true')));
 if live_role<>'owner' and coalesce((select numeric_value from public.business_settings where key='whatsapp_attendance_owner_approval_required'),1)=1 then can_confirm:=false; end if;
 update public.whatsapp_attendance_inbox set status='review',extracted=p_extracted,preview=p_preview,proposal_id=proposal.id,
 confirmation_token=token,confirmation_code=null,confirmation_proposal=proposal.id,confirmation_expires_at=null,lease_until=null,error_code=null where id=q.id;
 buttons:=jsonb_build_array(jsonb_build_object('id','attendance:cancel:'||q.id||':'||token,'title','ביטול'));
 if can_confirm then
  final_text:=E'האם לשמור את הדיווח?\nהאישור תקף ל־10 דקות.';
  buttons:=jsonb_build_array(jsonb_build_object('id','attendance:confirm:'||q.id||':'||token,'title','אשר ושמור'))||buttons;
 elsif live_role<>'owner' and coalesce((select numeric_value from public.business_settings where key='whatsapp_attendance_owner_approval_required'),1)=1 then
  final_text:='ℹ️ לפי הגדרות העסק נדרש אישור בעלים. פנו לבעלים באפליקציה.';
 else final_text:='בדקו את הפרטים ושלחו דיווח מתוקן. לא נשמרו שעות.';
 end if;
 -- Keep the single-worker case in one interactive message when Meta permits.
 parts:=p_parts||jsonb_build_array(final_text);
 if jsonb_array_length(p_parts)=1 and length(p_parts->>0)+length(final_text)+2<=900 then
  final_text:=(p_parts->>0)||E'\n\n'||final_text;
  parts:=jsonb_build_array(final_text);
 end if;
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body,message_payload)
 values(q.id,q.phone,q.message_at,'summary','summary:'||q.id||':'||token,final_text,jsonb_build_object('parts',parts,'buttons',buttons,'policy','buttons_attendance_v2','confirmation_token',token)) on conflict(dedupe_key) do nothing;
 return true;
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
 elsif q.confirmation_token is distinct from d.token or q.status<>'review' then
  decision_result:=jsonb_build_object('status','report_changed'); feedback:='⚠️ הכפתור שייך לסיכום ישן או לדיווח שהשתנה. שלחו דיווח חדש לבדיקה.';
 elsif q.confirmation_expires_at is not null and d.received_at>q.confirmation_expires_at then
  decision_result:=jsonb_build_object('status','expired'); feedback:='⚠️ חלפו 10 דקות משליחת הסיכום. לא נשמרו שעות מהאישור הזה. שלחו שוב את הדיווח לקבלת כפתורים חדשים.';
 elsif d.source_type='interactive.button_reply' and d.received_at>clock_timestamp()-interval '1 hour' and exists(
  select 1 from public.whatsapp_attendance_receipts r where r.inbox_id=q.id and r.kind='summary'
   and r.status in ('pending','processing') and r.message_payload->>'policy'='buttons_attendance_v2'
   and r.message_payload->>'confirmation_token'=d.token::text
 ) then
  -- A fast reply can precede the sender worker's delivery-ack commit. Keep the
  -- decision durable; never report failure or consume crash retries for waiting.
  update public.whatsapp_attendance_decisions set status='pending',attempts=greatest(attempts-1,0),lease_until=null where id=d.id;
  return jsonb_build_object('status','awaiting_delivery');
 elsif q.preview->>'confirmationPolicy' is distinct from 'buttons_attendance_v2' then
  decision_result:=jsonb_build_object('status','report_changed'); feedback:='⚠️ הסיכום נוצר בגרסה קודמת. שלחו שוב את הדיווח לקבלת כפתורים חדשים.';
 elsif not exists(
  select 1 from public.whatsapp_attendance_receipts r where r.inbox_id=q.id and r.kind='summary'
   and r.status in ('sent','delivered','read') and r.provider_message_id is not null
   and r.message_payload->>'policy'='buttons_attendance_v2'
   and r.message_payload->>'confirmation_token'=d.token::text
   and (d.reply_context_message_id is null or d.reply_context_message_id=r.provider_message_id)
   and d.source_type='interactive.button_reply' and q.confirmation_expires_at is not null
 ) then
  decision_result:=jsonb_build_object('status','buttons_unavailable'); feedback:='⚠️ האישור ב־WhatsApp אינו זמין כרגע. בדקו את הדיווח באפליקציה או שלחו דיווח חדש לבדיקה.';
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
  begin
   -- Intake time is stamped by PostgreSQL, not by the browser or the sender.
   -- A timely click may wait in the durable queue past its original deadline.
   -- Only this report's isolated pending proposal receives processing grace.
   perform id from public.ai_attendance_imports where id=q.proposal_id for update;
   lock table public.event_assignments in share row exclusive mode;
   if exists(select 1 from public.ai_attendance_imports i where i.id=q.proposal_id and i.status='succeeded' and exists(
    select 1 from jsonb_array_elements(i.payload) r where (select count(*) from public.event_assignments a
     where a.event_id=i.event_id and a.employee_id=(r->>'employee_id')::uuid
      and a.work_start=(r->>'work_start')::timestamptz and a.work_end=(r->>'work_end')::timestamptz)<>1
   )) then
    decision_result:=jsonb_build_object('status','stale');
   elsif exists(select 1 from public.whatsapp_attendance_inbox other where other.id<>q.id and (other.proposal_id=q.proposal_id or other.confirmation_proposal=q.proposal_id))
    and exists(select 1 from public.ai_attendance_imports where id=q.proposal_id and status='pending') then
    decision_result:=jsonb_build_object('status','stale');
   else
    update public.ai_attendance_imports set expires_at=greatest(expires_at,clock_timestamp()+interval '2 minutes')
     where id=q.proposal_id and actor_id=d.actor_id and status='pending';
    decision_result:=public.approve_whatsapp_attendance(d.actor_id,q.id,q.proposal_id,false);
   end if;
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

create or replace function public.claim_whatsapp_attendance(p_receipt boolean default false) returns jsonb
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
  with candidate as (select id from public.whatsapp_attendance_inbox where attempts<5 and ((status='pending' and available_at<=now()) or (status='processing' and lease_until<now())) order by available_at,received_at for update skip locked limit 1)
  update public.whatsapp_attendance_inbox q set status='processing',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' from candidate c where q.id=c.id returning to_jsonb(q) into result;
 end if;
 return result;
end; $$;

-- Private service-only helpers. ACL changes are part of this transaction, so
-- none of the new functions can become visible with default PUBLIC execution.
create or replace function public.bind_whatsapp_attendance_proposal(p_actor uuid,p_inbox uuid,p_proposal uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox; p public.ai_attendance_imports;
begin
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
 select * into p from public.ai_attendance_imports where id=p_proposal and actor_id=p_actor for update;
 if q.id is null or q.status not in ('processing','review') or p.id is null
  or not exists(select 1 from public.profiles where id=p_actor and role=p.actor_role and role in ('owner','manager'))
  or (q.status='processing' and q.actor_id<>p_actor) then raise exception 'Unauthorized proposal binding' using errcode='42501'; end if;
 if p.status='pending' then
  if exists(select 1 from public.whatsapp_attendance_inbox other where other.id<>q.id and (other.proposal_id=p.id or other.confirmation_proposal=p.id)) then
   if (select count(*) from public.ai_attendance_imports where actor_id=p_actor and created_at>now()-interval '1 hour')>=100 then raise exception 'Proposal rate limit'; end if;
   insert into public.ai_attendance_imports(actor_id,actor_role,event_id,fingerprint,payload,expected,allow_new)
    values(p.actor_id,p.actor_role,p.event_id,p.fingerprint,p.payload,p.expected,p.allow_new) returning * into p;
  else
   update public.ai_attendance_imports set expires_at=clock_timestamp()+interval '10 minutes' where id=p.id returning * into p;
  end if;
 elsif p.status<>'succeeded' then raise exception 'Proposal no longer pending'; end if;
 update public.whatsapp_attendance_inbox set proposal_id=p.id where id=q.id;
 return jsonb_build_object('id',p.id,'expires_at',p.expires_at);
end; $$;
revoke all on function public.bind_whatsapp_attendance_proposal(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.bind_whatsapp_attendance_proposal(uuid,uuid,uuid) to service_role;

create or replace function public.ack_whatsapp_attendance_receipt(p_receipt uuid,p_lease uuid,p_provider text,p_final boolean,p_next_index int) returns boolean
language plpgsql security invoker set search_path='' as $$
declare r public.whatsapp_attendance_receipts; q public.whatsapp_attendance_inbox; stamp timestamptz;
begin
 select * into q from public.whatsapp_attendance_inbox where id=(select inbox_id from public.whatsapp_attendance_receipts where id=p_receipt) for update;
 select * into r from public.whatsapp_attendance_receipts where id=p_receipt for update;
 stamp:=clock_timestamp();
 if r.id is null or r.status<>'processing' or r.lease_token is distinct from p_lease or r.lease_until<=stamp
  or coalesce(length(p_provider),0)=0 or p_next_index<1 then return false; end if;
 if r.kind='summary' then
  if q.status<>'review' or r.message_payload->>'policy'<>'buttons_attendance_v2'
   or r.message_payload->>'confirmation_token' is distinct from q.confirmation_token::text then return false; end if;
  if p_final then
   update public.whatsapp_attendance_inbox set confirmation_expires_at=stamp+interval '10 minutes' where id=q.id;
   update public.ai_attendance_imports set expires_at=stamp+interval '10 minutes' where id=q.confirmation_proposal and status='pending'
    and not exists(select 1 from public.whatsapp_attendance_inbox other where other.id<>q.id and (other.proposal_id=q.confirmation_proposal or other.confirmation_proposal=q.confirmation_proposal));
  end if;
 end if;
 update public.whatsapp_attendance_receipts set status=case when p_final then 'sent' else 'pending' end,
  provider_message_id=case when p_final then p_provider else null end,sent_at=case when p_final then stamp else null end,
  part_index=p_next_index,attempts=case when p_final then attempts else 0 end,error_code=null,lease_until=null,available_at=stamp where id=r.id;
 return true;
end; $$;
revoke all on function public.ack_whatsapp_attendance_receipt(uuid,uuid,text,boolean,int) from public,anon,authenticated;
grant execute on function public.ack_whatsapp_attendance_receipt(uuid,uuid,text,boolean,int) to service_role;

create or replace function public.request_whatsapp_attendance_correction(p_inbox uuid,p_lease uuid,p_message text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox;
begin
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
 if q.id is null or q.status<>'processing' or q.lease_token is distinct from p_lease or q.lease_until<=clock_timestamp() then return false; end if;
 update public.whatsapp_attendance_inbox set status='review',error_code='INPUT_CORRECTION_REQUIRED',proposal_id=null,
  confirmation_token=null,confirmation_proposal=null,confirmation_expires_at=null,extracted=null,preview=null,lease_until=null where id=q.id;
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
  values(q.id,q.phone,q.message_at,'correction','correction:'||q.id,left(p_message,2000)) on conflict(dedupe_key) do nothing;
 return true;
end; $$;
revoke all on function public.request_whatsapp_attendance_correction(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.request_whatsapp_attendance_correction(uuid,uuid,text) to service_role;

create or replace function public.receive_whatsapp_attendance_button(p_message_id text,p_phone text,p_phone_id text,p_inbox uuid,p_token uuid,p_decision text,p_at timestamptz,p_reply_to text default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare accepted boolean;
begin
 accepted:=public.receive_whatsapp_attendance_decision(p_message_id,p_phone,p_phone_id,p_inbox,p_token,p_decision,p_at);
 if accepted then
  update public.whatsapp_attendance_decisions set source_type='interactive.button_reply',reply_context_message_id=p_reply_to
   where provider_message_id=p_message_id and status='pending' and source_type is null;
 end if;
 return accepted;
end; $$;
revoke all on function public.receive_whatsapp_attendance_button(text,text,text,uuid,uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.receive_whatsapp_attendance_button(text,text,text,uuid,uuid,text,timestamptz,text) to service_role;

create or replace function public.review_whatsapp_attendance(p_actor uuid,p_inbox uuid,p_action text) returns boolean
language plpgsql security invoker set search_path='' set lock_timeout='3s' set statement_timeout='8s' as $$
declare changed boolean;
begin
  perform id from public.profiles where id=p_actor for share;
  if not exists(select 1 from public.profiles where id=p_actor and role in ('owner','manager')) then
    raise exception 'Unauthorized' using errcode='42501';
  end if;
  if p_action='reject' then
    update public.whatsapp_attendance_inbox set status='rejected',reviewed_by=p_actor
      where id=p_inbox and status in ('review','failed','pending'); changed:=found;
  elsif p_action='retry' then
    update public.whatsapp_attendance_inbox set status='pending',attempts=0,error_code=null,available_at=now()
      where id=p_inbox and status='failed'; changed:=found;
  elsif p_action='retryReceipt' then
    -- A fresh summary requires a new snapshot and token, not an expired button.
    update public.whatsapp_attendance_inbox set status='pending',attempts=0,error_code=null,available_at=now(),
      confirmation_token=null,confirmation_code=null,confirmation_proposal=null,confirmation_expires_at=null,
      lease_token=null,lease_until=null where id=p_inbox and status='review'
      and exists(select 1 from public.whatsapp_attendance_receipts where inbox_id=p_inbox and kind='summary' and status in ('failed','expired'));
    changed:=found;
    if changed then
      update public.whatsapp_attendance_receipts set status='expired',error_code='SUMMARY_SUPERSEDED',lease_until=null
        where inbox_id=p_inbox and kind='summary' and status in ('pending','processing','failed');
    else
      update public.whatsapp_attendance_receipts set status='pending',attempts=0,error_code=null,available_at=now()
        where inbox_id=p_inbox and kind in ('result','correction','failure','feedback') and status in ('failed','expired')
        and exists(select 1 from public.whatsapp_attendance_inbox where id=p_inbox and (status='approved' or public.whatsapp_attendance_receipts.kind<>'result')); changed:=found;
    end if;
  else raise exception 'Invalid review action' using errcode='22023'; end if;
  if changed then
    insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(p_actor,p_inbox,p_action);
  end if;
  return changed;
end;
$$;
revoke all on function public.review_whatsapp_attendance(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_whatsapp_attendance(uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
