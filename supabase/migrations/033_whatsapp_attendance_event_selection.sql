begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $prerequisites$begin
 if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('prepare_whatsapp_event_selection','receive_whatsapp_event_selection')) then raise exception 'Event selection function already exists; inspect installation';end if;
 if to_regprocedure('public.complete_whatsapp_attendance_analysis(uuid,uuid,jsonb,jsonb,jsonb)') is null
 or to_regprocedure('public.ack_whatsapp_attendance_receipt(uuid,uuid,text,boolean,integer)') is null then raise exception 'Existing attendance confirmation infrastructure required';end if;
 perform preview,extracted,report_type from public.whatsapp_attendance_inbox limit 0;
 perform message_payload,dedupe_key from public.whatsapp_attendance_receipts limit 0;
end;$prerequisites$;
-- Independent extension to 026-era inbox/receipt contracts. No 029/030/031/032 dependency.
-- CREATE (not REPLACE): unknown installations fail atomically instead of overwriting.
create function public.prepare_whatsapp_event_selection(p_inbox uuid,p_lease uuid,p_extracted jsonb,p_preview jsonb,p_parts jsonb,p_ids uuid[]) returns boolean
language plpgsql security invoker set search_path='' as $$
declare q public.whatsapp_attendance_inbox; token uuid:=gen_random_uuid(); expiry timestamptz:=clock_timestamp()+interval '10 minutes'; snapshots jsonb; buttons jsonb; i int; role_name text; require_context boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended((select phone from public.whatsapp_attendance_inbox where id=p_inbox),33033));
 select * into q from public.whatsapp_attendance_inbox where id=p_inbox for update;
 if q.id is null or q.status<>'processing' or q.report_type<>'attendance' or q.lease_token is distinct from p_lease or q.lease_until<=clock_timestamp() then return false;end if;
 select p.role into role_name from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=q.phone and s.user_id=q.actor_id and s.enabled for share of s,p;
 if role_name is null or role_name not in ('owner','manager') then update public.whatsapp_attendance_inbox set status='rejected',error_code='SENDER_REVOKED',lease_until=null where id=q.id;return false;end if;
 if q.proposal_id is not null then raise exception 'EVENT_SELECTION_REQUIRES_NEW_REPORT';end if;
 if p_preview->>'eventMatchPolicy' is distinct from 'exact_event_match_v1' or nullif(p_preview->>'eventId','') is not null or p_preview->>'proposalId' is not null
 or p_ids is null or cardinality(p_ids) not between 2 and 20 or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x)
 or jsonb_typeof(p_preview->'events') is distinct from 'array' or jsonb_array_length(p_preview->'events')<>cardinality(p_ids)
 or jsonb_typeof(p_parts) is distinct from 'array' or jsonb_array_length(p_parts) not between 1 and 100
 or exists(select 1 from jsonb_array_elements(p_parts) x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>3500) then raise exception 'INVALID_EVENT_SELECTION';end if;
 -- Lock and snapshot the real catalog rows; never derive an ID from response text.
 perform e.id from public.events e where e.id=any(p_ids) order by e.id for share;
 perform v.id from public.venues v join public.events e on e.venue_id=v.id where e.id=any(p_ids) order by v.id for share of v;
 if exists(select 1 from unnest(p_ids) with ordinality ids(id,n) left join public.events e on e.id=ids.id left join public.venues v on v.id=e.venue_id
 where e.id is null or v.id is null or (p_preview->'events'->((ids.n-1)::int)->>'id') is distinct from e.id::text
 or (p_preview->'events'->((ids.n-1)::int)->>'event_date') is distinct from e.event_date::text
 or (p_preview->'events'->((ids.n-1)::int)->>'event_type') is distinct from e.event_type
 or (p_preview->'events'->((ids.n-1)::int)->>'client_name') is distinct from e.client_name
 or (p_preview->'events'->((ids.n-1)::int)->>'venueName') is distinct from v.name
 or extract(day from e.event_date)::text is distinct from (p_extracted->>'day')
 or extract(month from e.event_date)::text is distinct from (p_extracted->>'month')
 or (p_extracted->>'year' is not null and extract(year from e.event_date)::text<>p_extracted->>'year')
 or (p_extracted->>'weekday' is not null and extract(dow from e.event_date)::text<>p_extracted->>'weekday')) then raise exception 'EVENT_SELECTION_CHANGED';end if;
 select jsonb_agg(jsonb_build_object('id',e.id,'date',e.event_date,'venue',e.venue_id,'type',e.event_type,'client',e.client_name,'hall',v.name) order by ids.n)
 into snapshots from unnest(p_ids) with ordinality ids(id,n) join public.events e on e.id=ids.id join public.venues v on v.id=e.venue_id;
 select exists(select 1 from public.whatsapp_attendance_inbox where id<>q.id and phone=q.phone and actor_id=q.actor_id and report_type='attendance' and status='review' and preview->'eventSelection'->>'state'='awaiting' and (preview->'eventSelection'->>'expiresAt')::timestamptz>clock_timestamp()) into require_context;
 if require_context then
  update public.whatsapp_attendance_inbox set preview=jsonb_set(preview,'{eventSelection,requireContext}','true'::jsonb)
   where id<>q.id and phone=q.phone and actor_id=q.actor_id and report_type='attendance' and status='review' and preview->'eventSelection'->>'state'='awaiting';
 end if;
 update public.whatsapp_attendance_inbox set status='review',extracted=p_extracted,
 preview=p_preview||jsonb_build_object('eventSelection',jsonb_build_object('state','awaiting','requireContext',require_context,'token',token,'expiresAt',expiry,'eventIds',to_jsonb(p_ids),'snapshots',snapshots)),
 proposal_id=null,confirmation_proposal=null,confirmation_token=null,confirmation_expires_at=null,lease_until=null,error_code=null where id=q.id;
 buttons:=jsonb_build_array(jsonb_build_object('id','attendance:choose:'||q.id||':'||token||':cancel','title','בטל'));
 if cardinality(p_ids)<=2 then
  for i in reverse cardinality(p_ids)..1 loop
   buttons:=jsonb_build_array(jsonb_build_object('id','attendance:choose:'||q.id||':'||token||':'||p_ids[i],'title','בחר '||i))||buttons;
  end loop;
 end if;
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body,message_payload)
 values(q.id,q.phone,q.message_at,'correction','event-list:'||q.id||':'||token,p_parts->>0,jsonb_build_object('policy','attendance_event_selection_v1','token',token,'parts',p_parts,'buttons',buttons));
 insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(q.actor_id,q.id,'event_selection_requested');
 return true;
end;$$;

create function public.receive_whatsapp_event_selection(p_message_id text,p_phone text,p_phone_id text,p_text text,p_at timestamptz,p_inbox uuid default null,p_token uuid default null,p_event uuid default null,p_action text default 'select',p_reply_to text default null) returns boolean
language plpgsql security invoker set search_path='' set lock_timeout='3s' set statement_timeout='8s' as $$
declare q public.whatsapp_attendance_inbox; actor uuid; role_name text; choice jsonb; pick uuid; snapshot jsonb; actual jsonb; feedback text; total int; wrong_context boolean:=false; stamp timestamptz:=clock_timestamp();
begin
 if coalesce(length(p_message_id),0) not between 1 and 500 or p_phone!~'^[1-9][0-9]{7,14}$' or p_at is null or p_at>stamp+interval '5 minutes' or p_action not in ('select','cancel') then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_phone,33033));
 select s.user_id,p.role into actor,role_name from public.whatsapp_attendance_senders s join public.profiles p on p.id=s.user_id where s.phone=p_phone and s.enabled for share of s,p;
 if actor is null or role_name is null or role_name not in ('owner','manager') then return false;end if;
 if exists(select 1 from public.whatsapp_attendance_receipts where dedupe_key='event-reply:'||p_message_id)
 or exists(select 1 from public.whatsapp_attendance_inbox where provider_message_id=p_message_id)
 or exists(select 1 from public.whatsapp_attendance_decisions where provider_message_id=p_message_id) then return true;end if;
 if p_inbox is not null then
  select * into q from public.whatsapp_attendance_inbox where id=p_inbox and phone=p_phone and actor_id=actor and phone_number_id=p_phone_id and report_type='attendance' for update;
 elsif p_reply_to is not null then
  select * into q from public.whatsapp_attendance_inbox x where x.phone=p_phone and x.actor_id=actor and x.phone_number_id=p_phone_id and x.report_type='attendance'
  and exists(select 1 from public.whatsapp_attendance_receipts r where r.inbox_id=x.id and r.provider_message_id=p_reply_to and r.message_payload->>'policy'='attendance_event_selection_v1') for update;
 else
  select count(*) into total from public.whatsapp_attendance_inbox where phone=p_phone and actor_id=actor and phone_number_id=p_phone_id and report_type='attendance' and status='review'
   and preview->'eventSelection'->>'state'='awaiting' and (preview->'eventSelection'->>'expiresAt')::timestamptz>stamp;
  if total=1 then
   select * into q from public.whatsapp_attendance_inbox where phone=p_phone and actor_id=actor and phone_number_id=p_phone_id and report_type='attendance' and status='review' and preview->'eventSelection'->>'state'='awaiting' and (preview->'eventSelection'->>'expiresAt')::timestamptz>stamp for update;
  elsif total>1 then feedback:='יש כמה רשימות פעילות. השיבו להודעת הרשימה המתאימה או השתמשו בכפתור שלה. לא נשמרו שעות.';
  end if;
 end if;
 if q.id is null then
  wrong_context:=p_inbox is not null or p_reply_to is not null;
  select * into q from public.whatsapp_attendance_inbox where phone=p_phone and actor_id=actor and phone_number_id=p_phone_id and report_type='attendance' order by received_at desc,id desc limit 1 for update;
 end if;
 if q.id is null then return false;end if;
 update public.whatsapp_attendance_inbox set message_at=greatest(message_at,p_at) where id=q.id;
 choice:=q.preview->'eventSelection';
 if feedback is not null then null;
 elsif wrong_context then feedback:='לא נמצאה רשימת הבחירה המתאימה. השיבו לרשימה העדכנית או שלחו דיווח חדש. לא נשמרו שעות.';
 elsif p_inbox is null and p_reply_to is null and choice->>'requireContext'='true' then feedback:='הרשימה הזאת הוצגה לצד רשימה נוספת. השיבו להודעת הרשימה או השתמשו בכפתור שלה. לא נשמרו שעות.';
 elsif q.status<>'review' or choice->>'state' is distinct from 'awaiting' then feedback:='אין רשימת אירועים פעילה להודעה הזאת. שלחו דיווח חדש או המתינו לסיכום ולאישור. לא נשמרו שעות מבחירה זו.';
 elsif p_token is not null and p_token::text is distinct from choice->>'token' then feedback:='הכפתור שייך לרשימה ישנה. בחרו מתוך הרשימה העדכנית. לא נשמרו שעות.';
 elsif (choice->>'expiresAt')::timestamptz<=stamp then
  update public.whatsapp_attendance_inbox set status='pending',attempts=0,available_at=stamp,error_code=null,preview=null,confirmation_token=null,confirmation_proposal=null,confirmation_expires_at=null where id=q.id;
  feedback:='תוקף הבחירה פג. אכין רשימה מעודכנת; בחרו שוב לאחר שתגיע. לא נשמרו שעות.';
 elsif not exists(select 1 from public.whatsapp_attendance_receipts r where r.inbox_id=q.id and r.kind='correction' and r.status in ('sent','delivered','read') and r.provider_message_id is not null and r.message_payload->>'token'=choice->>'token' and (p_reply_to is null or r.provider_message_id=p_reply_to)) then feedback:='רשימת הבחירה עדיין לא אומתה כנשלחה. המתינו ונסו לבחור שוב. לא נשמרו שעות.';
 elsif p_action='cancel' or btrim(coalesce(p_text,'')) in ('בטל','ביטול') then
  update public.whatsapp_attendance_inbox set status='rejected',reviewed_by=actor,preview=jsonb_set(q.preview,'{eventSelection,state}','"cancelled"'),confirmation_token=null where id=q.id;
  feedback:='בחירת האירוע והדיווח בוטלו. לא נשמרו שעות.';
  insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(actor,q.id,'event_selection_cancelled');
 else
  if p_event is not null then pick:=p_event;
  elsif btrim(coalesce(p_text,''))~'^[0-9]{1,3}[.)]?$' then
   total:=regexp_replace(btrim(p_text),'[.)]$','')::int;
   if total between 1 and jsonb_array_length(choice->'eventIds') then pick:=(choice->'eventIds'->>(total-1))::uuid;end if;
  end if;
  if pick is null or not (choice->'eventIds' @> jsonb_build_array(pick)) then feedback:='מספר הבחירה אינו תקין. בחרו מספר שמופיע ברשימה. לא נשמרו שעות.';
  else
   select value into snapshot from jsonb_array_elements(choice->'snapshots') where value->>'id'=pick::text;
   select jsonb_build_object('id',e.id,'date',e.event_date,'venue',e.venue_id,'type',e.event_type,'client',e.client_name,'hall',v.name) into actual
   from public.events e join public.venues v on v.id=e.venue_id where e.id=pick for share of e,v;
   if actual is distinct from snapshot then
    update public.whatsapp_attendance_inbox set status='pending',attempts=0,available_at=stamp,error_code=null,preview=null where id=q.id;
    feedback:='פרטי האירוע השתנו. אכין רשימת בחירה חדשה; בחרו שוב. לא נשמרו שעות.';
   else
    update public.whatsapp_attendance_inbox set status='pending',attempts=0,available_at=stamp,error_code=null,message_at=greatest(message_at,p_at),
     preview=jsonb_set(q.preview,'{eventSelection}',choice||jsonb_build_object('state','selected','eventId',pick,'replyMessageId',p_message_id)),
     proposal_id=null,confirmation_token=null,confirmation_proposal=null,confirmation_expires_at=null where id=q.id;
    feedback:='האירוע נבחר. אכין סיכום נוכחות לאישור מפורש; עדיין לא נשמרו שעות.';
    insert into public.whatsapp_attendance_audit(actor_id,inbox_id,action) values(actor,q.id,'event_selected');
   end if;
  end if;
 end if;
 -- This durable outbox key also deduplicates provider retries after preview is replaced.
 insert into public.whatsapp_attendance_receipts(inbox_id,phone,message_at,kind,dedupe_key,body)
 values(q.id,p_phone,p_at,'feedback','event-reply:'||p_message_id,feedback) on conflict(dedupe_key) do nothing;
 return true;
end;$$;
revoke all on function public.prepare_whatsapp_event_selection(uuid,uuid,jsonb,jsonb,jsonb,uuid[]),public.receive_whatsapp_event_selection(text,text,text,text,timestamptz,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_whatsapp_event_selection(uuid,uuid,jsonb,jsonb,jsonb,uuid[]),public.receive_whatsapp_event_selection(text,text,text,text,timestamptz,uuid,uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
