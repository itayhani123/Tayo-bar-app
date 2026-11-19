-- READ ONLY, before independent 033. No business RPC is called.
with functions(signature) as(values
 ('public.claim_whatsapp_attendance(boolean)'),('public.complete_whatsapp_attendance_analysis(uuid,uuid,jsonb,jsonb,jsonb)'),
 ('public.ack_whatsapp_attendance_receipt(uuid,uuid,text,boolean,integer)'),('public.receive_whatsapp_attendance_button(text,text,text,uuid,uuid,text,timestamptz,text)'),
 ('public.execute_whatsapp_attendance_decision(uuid,uuid)'),('public.confirm_ai_attendance(uuid,uuid)')
), required_columns(table_name,column_name,type_name) as(values
 ('whatsapp_attendance_inbox','preview','jsonb'),('whatsapp_attendance_inbox','extracted','jsonb'),('whatsapp_attendance_inbox','report_type','text'),
 ('whatsapp_attendance_receipts','message_payload','jsonb'),('whatsapp_attendance_receipts','dedupe_key','text'),
 ('events','event_type','text'),('events','client_name','text')
), checks(check_name,status,details) as(
 select 'function:'||f.signature,case when p.oid is not null and not p.prosecdef and has_function_privilege('service_role',p.oid,'EXECUTE') then 'PASS' else 'FAIL' end,'Existing private attendance contract required'
 from functions f left join pg_proc p on p.oid=to_regprocedure(f.signature)
 union all select 'column:'||c.table_name||'.'||c.column_name,case when a.attnum is not null and format_type(a.atttypid,a.atttypmod)=c.type_name then 'PASS' else 'FAIL' end,'Existing JSON state/catalog field required'
 from required_columns c left join pg_attribute a on a.attrelid=to_regclass('public.'||c.table_name) and a.attname=c.column_name and not a.attisdropped
 union all select 'buttons_policy',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.complete_whatsapp_attendance_analysis(uuid,uuid,jsonb,jsonb,jsonb)') and prosrc like '%buttons_attendance_v2%') then 'PASS' else 'FAIL' end,'026-era button confirmation policy required; no shared function will be replaced'
 union all select '033_not_installed',case when not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in ('prepare_whatsapp_event_selection','receive_whatsapp_event_selection')) then 'PASS' else 'FAIL' end,'One-time CREATE migration; stop and inspect any existing variant'
 union all select 'receipt_dedupe',case when exists(select 1 from pg_index i where i.indrelid=to_regclass('public.whatsapp_attendance_receipts') and i.indisunique and i.indisvalid and i.indisready and i.indexprs is null and i.indpred is null and i.indnkeyatts=1 and ARRAY(select a.attname::text from unnest(i.indkey) with ordinality k(num,n) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num where k.n<=i.indnkeyatts order by k.n)=ARRAY['dedupe_key']) then 'PASS' else 'FAIL' end,'Existing durable outbox unique key required'
)
select check_name,status,details from checks order by check_name;
