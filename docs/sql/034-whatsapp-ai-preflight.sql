-- READ ONLY BEFORE 034. No business RPC, DDL, locks or user details.
WITH expected(signature,body_md5s) AS(VALUES ('public.receive_whatsapp_attendance(text,text,text,text,timestamp with time zone)',ARRAY['b68c2839dbf100c5da47bcca8a0c0be2','25e1b9ed098814007e3e35fc33b1724a']),
('public.claim_whatsapp_attendance(boolean)',ARRAY['e899d01490b7fafc5c5ee2b16cf232e3'])),checks AS(
 SELECT signature check_name,CASE WHEN p.oid IS NOT NULL AND NOT p.prosecdef AND md5(btrim(replace(p.prosrc,chr(13),''),chr(32)||chr(9)||chr(10)))=ANY(e.body_md5s) AND p.proconfig=ARRAY['search_path=""']::text[] AND pg_get_userbyid(p.proowner)='postgres'
 AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'PASS' ELSE 'FAIL' END status,
 coalesce(md5(btrim(replace(p.prosrc,chr(13),''),chr(32)||chr(9)||chr(10))),'missing') details FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 UNION ALL SELECT '033.selection',CASE WHEN to_regprocedure('public.prepare_whatsapp_event_selection(uuid,uuid,jsonb,jsonb,jsonb,uuid[])') IS NOT NULL AND to_regprocedure('public.receive_whatsapp_event_selection(text,text,text,text,timestamptz,uuid,uuid,uuid,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,'Existing selection required'
 UNION ALL SELECT '034.not_installed',CASE WHEN to_regclass('public.whatsapp_ai_tasks') IS NULL AND to_regclass('public.whatsapp_ai_usage') IS NULL AND to_regclass('public.whatsapp_ai_audit') IS NULL AND to_regclass('public.whatsapp_ai_control') IS NULL AND to_regclass('public.whatsapp_ai_senders') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('whatsapp_ai_control_changed','whatsapp_ai_allowlist_changed','whatsapp_ai_user_active','whatsapp_ai_access','set_whatsapp_ai_control','set_whatsapp_ai_sender','read_whatsapp_ai_admin','whatsapp_ai_priority_busy','receive_whatsapp_ai','whatsapp_ai_identity','claim_whatsapp_ai','read_whatsapp_ai_snapshot','complete_whatsapp_ai','ack_whatsapp_ai','fail_whatsapp_ai_delivery')) THEN 'PASS' ELSE 'FAIL' END,'If installed, run verify instead; unknown overloads/partial objects must stop'
 UNION ALL SELECT 'auth.activity_columns',CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name IN ('banned_until','deleted_at') AND data_type='timestamp with time zone')=2 THEN 'PASS' ELSE 'FAIL' END,'Auth activity must be enforceable in SQL'
 UNION ALL SELECT 'single_business_schema',CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('events','profiles','venues','employees') AND column_name IN ('tenant_id','business_id','organization_id')) THEN 'FAIL' ELSE 'PASS' END,'Only one TAYO business per Supabase project is supported'
 UNION ALL SELECT 'business_mapping','WARNING','Manually confirm project and WHATSAPP_PHONE_NUMBER_ID belong only to TAYO; flag must remain false before installation'
 UNION ALL SELECT 'table.'||t,CASE WHEN to_regclass('public.'||t) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,'Required existing table' FROM unnest(ARRAY['whatsapp_attendance_inbox','whatsapp_attendance_receipts','whatsapp_attendance_decisions','whatsapp_attendance_senders','profiles','events','venues','employees','event_assignments','event_payments','venue_settlements','inventory_movements'])t
 UNION ALL SELECT 'inbox.provider_unique',CASE WHEN EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=to_regclass('public.whatsapp_attendance_inbox') AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts=1 AND pg_get_indexdef(i.indexrelid,1,true)='provider_message_id') THEN 'PASS' ELSE 'FAIL' END,'Shared message deduplication'
 UNION ALL SELECT 'column.'||e.tablename||'.'||e.columnname,CASE WHEN EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||e.tablename) AND a.attname=e.columnname AND NOT a.attisdropped AND a.atttypid=to_regtype(e.typename)) THEN 'PASS' ELSE 'FAIL' END,'Required type: '||e.typename FROM (VALUES ('events','id','uuid'),
('events','event_date','date'),
('events','start_time','time'),
('events','event_type','text'),
('events','venue_id','uuid'),
('events','guest_count','integer'),
('events','package_type','text'),
('events','payer_type','text'),
('events','price_per_guest','numeric'),
('events','vat_rate','numeric'),
('events','price_includes_vat','boolean'),
('events','estimated_alcohol_cost','numeric'),
('events','client_name','text'),
('venues','id','uuid'),
('venues','name','text'),
('employees','id','uuid'),
('employees','full_name','text'),
('profiles','id','uuid'),
('profiles','role','text'),
('event_assignments','id','uuid'),
('event_assignments','event_id','uuid'),
('event_assignments','employee_id','uuid'),
('event_assignments','event_role','text'),
('event_assignments','work_start','timestamptz'),
('event_assignments','work_end','timestamptz'),
('event_assignments','pay_type','text'),
('event_assignments','hourly_rate','numeric'),
('event_assignments','fixed_pay','numeric'),
('inventory_movements','id','uuid'),
('inventory_movements','event_id','uuid'),
('inventory_movements','kind','text'),
('inventory_movements','total_cost_agorot','bigint'),
('event_payments','id','uuid'),
('event_payments','event_id','uuid'),
('event_payments','amount','numeric'),
('event_payments','paid_at','timestamptz'),
('event_payments','payment_method','text'),
('venue_settlements','id','uuid'),
('venue_settlements','venue_id','uuid'),
('venue_settlements','cutoff_date','date'),
('venue_settlements','amount','numeric'),
('venue_settlements','created_at','timestamptz'),
('venue_settlements','includes_hall_fee','boolean'),
('venue_settlements','allocations','jsonb'),
('venue_settlements','source_snapshot','jsonb'),
('whatsapp_attendance_senders','phone','text'),
('whatsapp_attendance_senders','user_id','uuid'),
('whatsapp_attendance_senders','enabled','boolean'))e(tablename,columnname,typename)
) SELECT * FROM checks ORDER BY check_name;
