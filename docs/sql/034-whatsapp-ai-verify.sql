-- READ ONLY AFTER 034. Do not execute intake, claim, send, quota or business functions.
WITH expected(signature,body_md5s,definer,volatility,browser) AS(VALUES ('public.whatsapp_ai_control_changed()',ARRAY['74d20a0970468d21377c6e6b4b677ddc'],true,'v',false),
('public.whatsapp_ai_allowlist_changed()',ARRAY['2df1deac7d95ad60949b699d521c29f4'],true,'v',false),
('public.whatsapp_ai_user_active(uuid)',ARRAY['5257d5dc324852431b847f8e264712bc'],true,'s',false),
('public.whatsapp_ai_access(text,uuid,text)',ARRAY['52564377e58ba0e01c0e53d79d85e09f'],true,'s',false),
('public.set_whatsapp_ai_control(boolean,text)',ARRAY['e006756e622717f14faf655ef2a91028'],true,'v',true),
('public.set_whatsapp_ai_sender(text,uuid,boolean)',ARRAY['48ceb228a6eac4e36670af88a006446a'],true,'v',true),
('public.read_whatsapp_ai_admin()',ARRAY['1100433c000cdb878ab9193682272979'],true,'s',true),
('public.whatsapp_ai_priority_busy()',ARRAY['87551e2168b7a2d381959c4866f6820c'],true,'s',false),
('public.receive_whatsapp_ai(text,text,text,text,timestamptz)',ARRAY['135746dc8dd7640dc0c2c2d6abb9d3da'],false,'v',false),
('public.whatsapp_ai_identity(uuid,uuid,text,text)',ARRAY['01a1fe5480686e7d99447240396fc9ee'],true,'s',false),
('public.claim_whatsapp_ai(text,boolean)',ARRAY['79c7f889e3212c8cf154a2580e71cca5'],false,'v',false),
('public.read_whatsapp_ai_snapshot(uuid,uuid,text,text,jsonb)',ARRAY['67326f68b203ebafc8954762e786c14c'],true,'s',false),
('public.complete_whatsapp_ai(uuid,uuid,text,text,text)',ARRAY['8af5b2468282fd3135a43b4e6904f902'],false,'v',false),
('public.ack_whatsapp_ai(uuid,uuid,text,text)',ARRAY['05024aa547c2207d04af5d084c9877ae'],false,'v',false),
('public.fail_whatsapp_ai_delivery(uuid,uuid)',ARRAY['6ca480490705848f5f3f064c8d38b485'],false,'v',false),
('public.receive_whatsapp_attendance(text,text,text,text,timestamp with time zone)',ARRAY['8946438f48517f966676373073bf617c','d65c10859435cebe0693f8071913700e'],false,'v',false),
('public.claim_whatsapp_attendance(boolean)',ARRAY['167604d06753b5279d1bd16e001aa850'],false,'v',false)),checks AS(
 SELECT e.signature check_name,CASE WHEN p.oid IS NOT NULL AND p.prosecdef=e.definer AND p.provolatile::text=e.volatility AND p.proconfig @> ARRAY['search_path=""']::text[] AND pg_get_userbyid(p.proowner)='postgres' AND md5(btrim(replace(p.prosrc,chr(13),''),chr(32)||chr(9)||chr(10)))=ANY(e.body_md5s)
 AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND has_function_privilege('authenticated',p.oid,'EXECUTE')=e.browser
 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'PASS' ELSE 'FAIL' END status,
 coalesce(md5(btrim(replace(p.prosrc,chr(13),''),chr(32)||chr(9)||chr(10))),'missing') details FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 UNION ALL SELECT 'table.'||t,CASE WHEN EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass('public.'||t) AND relrowsecurity) AND NOT has_table_privilege('authenticated',to_regclass('public.'||t),'SELECT') AND NOT has_table_privilege('anon',to_regclass('public.'||t),'SELECT') THEN 'PASS' ELSE 'FAIL' END,'RLS and browser isolation' FROM unnest(ARRAY['whatsapp_ai_tasks','whatsapp_ai_usage','whatsapp_ai_audit','whatsapp_ai_control','whatsapp_ai_senders'])t
 UNION ALL SELECT 'control.initially_disabled',CASE WHEN (SELECT count(*) FROM public.whatsapp_ai_control WHERE singleton AND NOT enabled AND revision=0)=1 THEN 'PASS' ELSE 'FAIL' END,'Installation verification only, before pilot configuration'
 UNION ALL SELECT 'allowlist.initially_empty',CASE WHEN NOT EXISTS(SELECT 1 FROM public.whatsapp_ai_senders) THEN 'PASS' ELSE 'FAIL' END,'No default AI users'
 UNION ALL SELECT 'control.revision_trigger',CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.whatsapp_ai_control') AND tgname='whatsapp_ai_control_revision' AND tgenabled='O') THEN 'PASS' ELSE 'FAIL' END,'Every control change invalidates old leases'
 UNION ALL SELECT 'allowlist.revision_trigger',CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.whatsapp_ai_senders') AND tgname='whatsapp_ai_allowlist_revision' AND tgenabled='O') THEN 'PASS' ELSE 'FAIL' END,'Every allowlist change invalidates old leases'
 UNION ALL SELECT 'control.owner_only_write',CASE WHEN NOT has_table_privilege('service_role','public.whatsapp_ai_control','UPDATE') AND NOT has_table_privilege('authenticated','public.whatsapp_ai_senders','UPDATE') THEN 'PASS' ELSE 'FAIL' END,'Owner RPC checks auth.uid, active Auth user and owner role'
 UNION ALL SELECT 'feature_flag','WARNING','Keep WHATSAPP_AI_FALLBACK_ENABLED=false until source, phone mapping and controlled regression checks are approved'
) SELECT * FROM checks ORDER BY check_name;
