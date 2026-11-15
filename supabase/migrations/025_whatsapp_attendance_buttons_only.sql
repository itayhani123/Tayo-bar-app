begin;
-- Button-only policy. Reuse the current attendance transaction and private ACLs.
create or replace function public.complete_whatsapp_attendance_analysis(p_inbox uuid,p_lease uuid,p_extracted jsonb,p_preview jsonb,p_parts jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox; token uuid; proposal public.ai_attendance_imports; can_confirm boolean; buttons jsonb; final_text text; parts jsonb; live_role text;
begin
 if p_preview->>'confirmationPolicy' is distinct from 'buttons_auto_assignment_v1' then raise exception 'WHATSAPP_WORKER_VERSION_MISMATCH' using errcode='22023'; end if;
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
 confirmation_token=token,confirmation_code=null,confirmation_proposal=proposal.id,confirmation_expires_at=case when proposal.status='succeeded' then now()+interval '10 minutes' else least(coalesce(proposal.expires_at,now()+interval '10 minutes'),now()+interval '10 minutes') end,lease_until=null,error_code=null where id=q.id;
 buttons:=jsonb_build_array(jsonb_build_object('id','attendance:cancel:'||q.id||':'||token,'title','❌ בטל'));
 if can_confirm then
  final_text:=E'האם לשמור את הדיווח?\nהאישור תקף ל־10 דקות.';
  buttons:=jsonb_build_array(jsonb_build_object('id','attendance:confirm:'||q.id||':'||token,'title','✅ אשר ושמור'))||buttons;
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
 values(q.id,q.phone,q.message_at,'summary','summary:'||q.id||':'||token,final_text,jsonb_build_object('parts',parts,'buttons',buttons,'policy','buttons_auto_assignment_v1','confirmation_token',token)) on conflict(dedupe_key) do nothing;
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
 elsif q.confirmation_token is distinct from d.token or q.confirmation_expires_at<=now() or q.status<>'review' then
  decision_result:=jsonb_build_object('status','expired'); feedback:='⚠️ תוקף האישור פג או שהדיווח השתנה. שלחו שוב את הדיווח לבדיקה.';
 elsif q.preview->>'confirmationPolicy' is distinct from 'buttons_auto_assignment_v1' or not exists(
  select 1 from public.whatsapp_attendance_receipts r where r.inbox_id=q.id and r.kind='summary'
   and r.status in ('sent','delivered','read') and r.provider_message_id is not null
   and r.message_payload->>'policy'='buttons_auto_assignment_v1'
   and r.message_payload->>'confirmation_token'=d.token::text
 ) then
  decision_result:=jsonb_build_object('status','buttons_unavailable'); feedback:='⚠️ האישור ב־WhatsApp אינו זמין כרגע. פתחו את הדיווח באפליקציה ובקשו לשלוח כפתורים מחדש.';
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
        where inbox_id=p_inbox and kind='result' and status in ('failed','expired')
        and exists(select 1 from public.whatsapp_attendance_inbox where id=p_inbox and status='approved'); changed:=found;
    end if;
  else raise exception 'Invalid review action' using errcode='22023'; end if;
  if changed then
    insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(p_actor,p_inbox,p_action);
  end if;
  return changed;
end;
$$;

-- Remove the obsolete text-command capability even for callers on an old build.
create or replace function public.receive_whatsapp_attendance_short_decision(p_message_id text,p_phone text,p_phone_id text,p_code text,p_decision text,p_at timestamptz) returns boolean
language sql security invoker set search_path='' as $$select false$$;

-- Safely re-prepare only unapproved reports created under the old policy. This
-- writes queue metadata, never assignments/hours. Old buttons become invalid.
insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action)
 select actor_id,id,'buttons_policy_reprepare' from public.whatsapp_attendance_inbox
 where status='review' and preview->>'confirmationPolicy' is distinct from 'buttons_auto_assignment_v1';
update public.whatsapp_attendance_inbox set status='pending',attempts=0,error_code=null,available_at=now(),
 confirmation_token=null,confirmation_code=null,confirmation_proposal=null,confirmation_expires_at=null,lease_token=null,lease_until=null
 where status='review' and preview->>'confirmationPolicy' is distinct from 'buttons_auto_assignment_v1';
update public.whatsapp_attendance_receipts set status='expired',error_code='SUMMARY_POLICY_OUTDATED',lease_until=null
 where kind='summary' and status in ('pending','processing','failed')
 and message_payload->>'policy' is distinct from 'buttons_auto_assignment_v1';

notify pgrst,'reload schema';
commit;
