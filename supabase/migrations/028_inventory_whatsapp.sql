begin;
create function public.inventory_cancel(p_actor uuid,p_report uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.inventory_reports;role_name text;begin
 role_name:=public.inventory_role(p_actor);select * into r from public.inventory_reports where id=p_report for update;
 if r.id is null or (r.actor_id<>p_actor and role_name<>'owner') then raise exception 'INVENTORY_FORBIDDEN' using errcode='42501';end if;
 if r.status='pending' then
  update public.inventory_reports set status='cancelled' where id=r.id;
  update public.whatsapp_attendance_inbox set status='rejected',reviewed_by=p_actor where id=r.inbox_id and status='review';return true;
 end if;return r.status='cancelled';
end;$$;
create function public.inventory_catalog(p_actor uuid,p_day int,p_month int,p_year int) returns jsonb language plpgsql security invoker set search_path='' as $$begin
 perform public.inventory_role(p_actor);
 return jsonb_build_object('products',coalesce((select jsonb_agg(to_jsonb(x)-'cost_agorot') from(select * from public.inventory_products where active order by id limit 3001)x),'[]'::jsonb),
 'events',coalesce((select jsonb_agg(to_jsonb(x)) from(select e.id,e.event_date,e.client_name,v.name venue_name from public.events e join public.venues v on v.id=e.venue_id
  where (p_day is null or extract(day from e.event_date)=p_day) and (p_month is null or extract(month from e.event_date)=p_month) and (p_year is null or extract(year from e.event_date)=p_year) order by e.event_date,e.id limit 501)x),'[]'::jsonb));
end;$$;
create function public.receive_inventory_whatsapp(p_message_id text,p_phone text,p_phone_id text,p_text text,p_at timestamptz) returns boolean language plpgsql security invoker set search_path='' as $$
declare accepted boolean;begin
 accepted:=public.receive_whatsapp_attendance(p_message_id,p_phone,p_phone_id,p_text,p_at);
 if accepted then update public.whatsapp_attendance_inbox set report_type='inventory' where provider_message_id=p_message_id and phone=p_phone and status='pending' and attempts=0;end if;
 return accepted;
end;$$;
create function public.prepare_inventory_whatsapp(p_actor uuid,p_inbox uuid,p_lease uuid,p_kind text,p_event uuid,p_lines jsonb,p_summary text) returns boolean language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox;token uuid;buttons jsonb;parts jsonb;body text;begin
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
 if q.id is null or q.status<>'processing' or q.report_type<>'inventory' or q.lease_token is distinct from p_lease or q.lease_until<=clock_timestamp() then return false;end if;
 perform public.inventory_prepare(p_actor,p_kind,p_event,p_lines,p_inbox,null,p_inbox);
 token:=gen_random_uuid();body:='האם לעדכן את המלאי? האישור תקף ל־10 דקות.';
 buttons:=jsonb_build_array(jsonb_build_object('id','inventory:confirm:'||q.id||':'||token,'title','אשר ועדכן'),jsonb_build_object('id','inventory:cancel:'||q.id||':'||token,'title','בטל'));
 if length(p_summary)<800 then parts:=jsonb_build_array(p_summary||E'\n\n'||body);
 else
  -- Bound every part to Meta text limits. The final interactive body stays short.
  select coalesce(jsonb_agg(substr(p_summary,n,3000)),'[]'::jsonb)||jsonb_build_array(body) into parts from generate_series(1,length(p_summary),3000)n;
 end if;
 update public.whatsapp_attendance_inbox set status='review',confirmation_token=token,confirmation_code=null,confirmation_expires_at=null,error_code=null,event_id=p_event,lease_until=null where id=q.id;
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body,message_payload)
  values(q.id,q.phone,q.message_at,'summary','inventory-summary:'||q.id||':'||token,body,jsonb_build_object('policy','inventory_bottles_v1','parts',parts,'buttons',buttons,'confirmation_token',token));return true;
end;$$;
create function public.execute_inventory_decision(p_id uuid,p_lease uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.whatsapp_attendance_decisions;q public.whatsapp_attendance_inbox;r public.inventory_reports;decision_result jsonb;body text;label text;count_bottles int;begin
 select * into d from public.whatsapp_attendance_decisions where id=p_id for update;
 if d.id is null or d.lease_token is distinct from p_lease then return jsonb_build_object('status','stale');end if;
 if d.status='done' then return d.result;end if;
 if d.status<>'processing' or d.lease_until<=clock_timestamp() then return jsonb_build_object('status','stale');end if;
 select * into q from public.whatsapp_attendance_inbox where id=d.inbox_id for update;
 perform s.phone from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=d.phone for share of s,p;
 if q.actor_id<>d.actor_id or q.phone<>d.phone or not exists(select 1 from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=d.phone and s.user_id=d.actor_id and s.enabled and p.role in ('owner','manager')) then decision_result:=jsonb_build_object('status','forbidden');body:='אין הרשאה לעדכון המלאי. פנו לבעלים.';
 elsif q.status='approved' then decision_result:=jsonb_build_object('status','succeeded','replayed',true);body:='✅ הדיווח כבר נשמר. לא בוצע שינוי נוסף במלאי.';
 elsif q.status='rejected' then decision_result:=jsonb_build_object('status','cancelled');body:='הדיווח בוטל. המלאי לא השתנה.';
 elsif q.confirmation_token is distinct from d.token or q.status<>'review' then decision_result:=jsonb_build_object('status','stale');body:='הכפתור שייך לסיכום ישן. שלחו דיווח חדש.';
 elsif q.confirmation_expires_at is not null and d.received_at>q.confirmation_expires_at then decision_result:=jsonb_build_object('status','expired');body:='תוקף האישור פג. שלחו שוב את הדיווח לקבלת סיכום חדש.';
 elsif d.source_type='interactive.button_reply' and exists(select 1 from public.whatsapp_attendance_receipts x where x.inbox_id=q.id and x.kind='summary' and x.status in ('pending','processing') and x.message_payload->>'confirmation_token'=d.token::text) and d.received_at>clock_timestamp()-interval '1 hour' then
  update public.whatsapp_attendance_decisions set status='pending',attempts=greatest(attempts-1,0),lease_until=null where id=d.id;return jsonb_build_object('status','awaiting_delivery');
 elsif q.confirmation_expires_at is null or d.source_type is distinct from 'interactive.button_reply' or not exists(select 1 from public.whatsapp_attendance_receipts x where x.inbox_id=q.id and x.kind='summary' and x.status in ('sent','delivered','read') and x.provider_message_id is not null and x.message_payload->>'confirmation_token'=d.token::text and x.message_payload->>'policy'='inventory_bottles_v1' and (d.reply_context_message_id is null or d.reply_context_message_id=x.provider_message_id)) then decision_result:=jsonb_build_object('status','buttons_unavailable');body:='לא ניתן לאמת את הכפתור. שלחו דיווח חדש.';
 elsif d.decision='cancel' then perform public.inventory_cancel(d.actor_id,q.id);decision_result:=jsonb_build_object('status','cancelled');body:='הדיווח בוטל. המלאי לא השתנה.';
 else
  begin decision_result:=public.inventory_confirm(d.actor_id,q.id,d.id);exception when others then decision_result:=jsonb_build_object('status','failed');end;
  if decision_result->>'status'='succeeded' then
   select * into r from public.inventory_reports where id=q.id;
   select coalesce(sum((value->>'quantity')::int),0) into count_bottles from jsonb_array_elements(r.lines);
   select v.name into label from public.events e join public.venues v on v.id=e.venue_id where e.id=r.event_id;
   body:=case when r.kind='receipt' then '✅ קליטת המלאי עודכנה בהצלחה. '||count_bottles||' בקבוקים נוספו למלאי.' else '✅ צריכת האלכוהול באירוע '||coalesce(label,'')||' עודכנה בהצלחה. '||count_bottles||' בקבוקים הופחתו מהמלאי.' end;
   update public.whatsapp_attendance_inbox set status='approved',approved_at=now(),reviewed_by=d.actor_id,error_code=null where id=q.id;
  else
   body:=case when decision_result->>'status'='insufficient_stock' then 'אין מספיק מלאי זמין. לא נשמר שום חלק מהדיווח. בדקו כמויות ושלחו שוב.' when decision_result->>'status'='forbidden' then 'אין הרשאה לפעולה הזאת. פנו לבעלים.' else 'עדכון המלאי נכשל או שהנתונים השתנו. לא נשמר שום חלק מהדיווח. שלחו דיווח חדש לאחר בדיקה.' end;
   update public.inventory_reports set status='failed' where id=q.id and status='pending';update public.whatsapp_attendance_inbox set status='failed',error_code='INVENTORY_CONFIRMATION_FAILED' where id=q.id;
  end if;
 end if;
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body) values(q.id,d.phone,d.message_at,'feedback','inventory-decision:'||d.id,body) on conflict(dedupe_key) do nothing;
 update public.whatsapp_attendance_decisions set status='done',result=decision_result,lease_until=null where id=d.id;
 insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(d.actor_id,q.id,'inventory_'||d.decision||'_'||(decision_result->>'status'));return decision_result;
end;$$;

-- These functions are appended below from 026 with only a domain dispatch and
-- an additional acknowledged-summary policy; the attendance branch is retained.

create or replace function public.execute_whatsapp_attendance_decision(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $$
declare d public.whatsapp_attendance_decisions; q public.whatsapp_attendance_inbox; role_name text; decision_result jsonb; feedback text;
begin
 if exists(select 1 from public.whatsapp_attendance_decisions decision_row join public.whatsapp_attendance_inbox inbox_row on inbox_row.id=decision_row.inbox_id where decision_row.id=p_id and inbox_row.report_type='inventory') then return public.execute_inventory_decision(p_id,p_lease);end if;
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
  if q.status<>'review' or not ((q.report_type='attendance' and r.message_payload->>'policy'='buttons_attendance_v2') or (q.report_type='inventory' and r.message_payload->>'policy'='inventory_bottles_v1'))
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


do $$declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('inventory_cancel','inventory_catalog','receive_inventory_whatsapp','prepare_inventory_whatsapp','execute_inventory_decision','execute_whatsapp_attendance_decision','ack_whatsapp_attendance_receipt') loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;end;$$;
notify pgrst,'reload schema';
commit;
