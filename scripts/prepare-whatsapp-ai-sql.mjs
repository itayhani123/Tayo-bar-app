// Offline only. Generate read-only verification from the reviewed local sources.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('md5').update(s.replaceAll('\r','').replace(/^[ \t\n]+|[ \t\n]+$/g,'')).digest('hex');
const sql=read('supabase/migrations/034_whatsapp_ai_readonly.sql');
const functions=[...sql.matchAll(/create function public\.(\w+)\(([^)]*)\) returns ([\s\S]*?)as \$\$([\s\S]*?)\$\$;/g)].map(m=>({name:m[1],signature:'public.'+m[1]+'('+m[2].split(',').filter(Boolean).map(a=>a.trim().replace(/^p_\w+\s+/,'').replace(/\s+default[\s\S]*/i,'')).join(',')+')',hash:hash(m[4]),stable:/\bstable\b/i.test(m[3]),definer:/security definer/i.test(m[3]),browser:['set_whatsapp_ai_control','set_whatsapp_ai_sender','read_whatsapp_ai_admin'].includes(m[1])}));
if(functions.length!==15)throw Error('Unexpected migration function list');
const legacy=[['020_whatsapp_attendance_inbox','receive_whatsapp_attendance','public.receive_whatsapp_attendance(text,text,text,text,timestamp with time zone)'],['026_whatsapp_attendance_reliability','claim_whatsapp_attendance','public.claim_whatsapp_attendance(boolean)']].map(([file,name,signature])=>{
 const m=[...read(`supabase/migrations/${file}.sql`).matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/g)].find(m=>m[1]===name);
 if(!m)throw Error('Missing source');let target=m[2];
 if(name==='receive_whatsapp_attendance')target=target.replace('where phone=p_phone and received_at',"where report_type<>'ai_question' and phone=p_phone and received_at");
 else target=target.replace('public.whatsapp_attendance_inbox where attempts<5',"public.whatsapp_attendance_inbox where report_type<>'ai_question' and attempts<5").replace('public.whatsapp_attendance_receipts where attempts<5',"public.whatsapp_attendance_receipts where kind<>'ai_answer' and attempts<5");
 const sources=[hash(m[2])],targets=[hash(target)];
 if(name==='receive_whatsapp_attendance'){
  // Reviewed against the full supplied Production body, not a hash-only exception.
  const old="then raise exception 'Sender rate limit; retry delivery later'; end if;";
  if(m[2].split(old).length!==2)throw Error('Unexpected 020 cap branch');
  sources.push(hash(m[2].replace(old,'then return false; end if;')));
  targets.push(hash(target.replace(old,'then return false; end if;')));
  if(sources[1]!=='25e1b9ed098814007e3e35fc33b1724a'||targets[1]!=='d65c10859435cebe0693f8071913700e')throw Error('Reviewed Production variant drift');
 }
 return{signature,sources,targets};
});
mkdirSync('docs/sql',{recursive:true});
const hashArray=values=>`ARRAY[${values.map(v=>`'${v}'`).join(',')}]`;
const rows=legacy.map(f=>`('${f.signature}',${hashArray(f.sources)})`).join(',\n');
const requiredColumns={
 events:'id:uuid,event_date:date,start_time:time,event_type:text,venue_id:uuid,guest_count:integer,package_type:text,payer_type:text,price_per_guest:numeric,vat_rate:numeric,price_includes_vat:boolean,estimated_alcohol_cost:numeric,client_name:text',
 venues:'id:uuid,name:text',employees:'id:uuid,full_name:text',profiles:'id:uuid,role:text',
 event_assignments:'id:uuid,event_id:uuid,employee_id:uuid,event_role:text,work_start:timestamptz,work_end:timestamptz,pay_type:text,hourly_rate:numeric,fixed_pay:numeric',
 inventory_movements:'id:uuid,event_id:uuid,kind:text,total_cost_agorot:bigint',
 event_payments:'id:uuid,event_id:uuid,amount:numeric,paid_at:timestamptz,payment_method:text',
 venue_settlements:'id:uuid,venue_id:uuid,cutoff_date:date,amount:numeric,created_at:timestamptz,includes_hall_fee:boolean,allocations:jsonb,source_snapshot:jsonb',
 whatsapp_attendance_senders:'phone:text,user_id:uuid,enabled:boolean'
};
const columnRows=Object.entries(requiredColumns).flatMap(([table,fields])=>fields.split(',').map(field=>{const[name,type]=field.split(':');return `('${table}','${name}','${type}')`;})).join(',\n');
const pre=`-- READ ONLY BEFORE 034. No business RPC, DDL, locks or user details.
WITH expected(signature,body_md5s) AS(VALUES ${rows}),checks AS(
 SELECT signature check_name,CASE WHEN p.oid IS NOT NULL AND NOT p.prosecdef AND md5(btrim(replace(p.prosrc,chr(13),''),chr(32)||chr(9)||chr(10)))=ANY(e.body_md5s) AND p.proconfig=ARRAY['search_path=""']::text[] AND pg_get_userbyid(p.proowner)='postgres'
 AND has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
 AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') THEN 'PASS' ELSE 'FAIL' END status,
 coalesce(md5(btrim(replace(p.prosrc,chr(13),''),chr(32)||chr(9)||chr(10))),'missing') details FROM expected e LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
 UNION ALL SELECT '033.selection',CASE WHEN to_regprocedure('public.prepare_whatsapp_event_selection(uuid,uuid,jsonb,jsonb,jsonb,uuid[])') IS NOT NULL AND to_regprocedure('public.receive_whatsapp_event_selection(text,text,text,text,timestamptz,uuid,uuid,uuid,text,text)') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,'Existing selection required'
 UNION ALL SELECT '034.not_installed',CASE WHEN to_regclass('public.whatsapp_ai_tasks') IS NULL AND to_regclass('public.whatsapp_ai_usage') IS NULL AND to_regclass('public.whatsapp_ai_audit') IS NULL AND to_regclass('public.whatsapp_ai_control') IS NULL AND to_regclass('public.whatsapp_ai_senders') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (${functions.map(f=>"'"+f.name+"'").join(',')})) THEN 'PASS' ELSE 'FAIL' END,'If installed, run verify instead; unknown overloads/partial objects must stop'
 UNION ALL SELECT 'auth.activity_columns',CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema='auth' AND table_name='users' AND column_name IN ('banned_until','deleted_at') AND data_type='timestamp with time zone')=2 THEN 'PASS' ELSE 'FAIL' END,'Auth activity must be enforceable in SQL'
 UNION ALL SELECT 'single_business_schema',CASE WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('events','profiles','venues','employees') AND column_name IN ('tenant_id','business_id','organization_id')) THEN 'FAIL' ELSE 'PASS' END,'Only one TAYO business per Supabase project is supported'
 UNION ALL SELECT 'business_mapping','WARNING','Manually confirm project and WHATSAPP_PHONE_NUMBER_ID belong only to TAYO; flag must remain false before installation'
 UNION ALL SELECT 'table.'||t,CASE WHEN to_regclass('public.'||t) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,'Required existing table' FROM unnest(ARRAY['whatsapp_attendance_inbox','whatsapp_attendance_receipts','whatsapp_attendance_decisions','whatsapp_attendance_senders','profiles','events','venues','employees','event_assignments','event_payments','venue_settlements','inventory_movements'])t
 UNION ALL SELECT 'inbox.provider_unique',CASE WHEN EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=to_regclass('public.whatsapp_attendance_inbox') AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indnkeyatts=1 AND pg_get_indexdef(i.indexrelid,1,true)='provider_message_id') THEN 'PASS' ELSE 'FAIL' END,'Shared message deduplication'
 UNION ALL SELECT 'column.'||e.tablename||'.'||e.columnname,CASE WHEN EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=to_regclass('public.'||e.tablename) AND a.attname=e.columnname AND NOT a.attisdropped AND a.atttypid=to_regtype(e.typename)) THEN 'PASS' ELSE 'FAIL' END,'Required type: '||e.typename FROM (VALUES ${columnRows})e(tablename,columnname,typename)
) SELECT * FROM checks ORDER BY check_name;
`;
const after=[...functions.map(f=>`('${f.signature}',${hashArray([f.hash])},${f.definer},'${f.stable?'s':'v'}',${f.browser})`),...legacy.map(f=>`('${f.signature}',${hashArray(f.targets)},false,'v',false)`)].join(',\n');
const verify=`-- READ ONLY AFTER 034. Do not execute intake, claim, send, quota or business functions.
WITH expected(signature,body_md5s,definer,volatility,browser) AS(VALUES ${after}),checks AS(
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
`;
writeFileSync('docs/sql/034-whatsapp-ai-preflight.sql',pre);writeFileSync('docs/sql/034-whatsapp-ai-verify.sql',verify);
console.log(JSON.stringify({readOnly:true,newFunctions:functions.length,guardedLegacyFunctions:legacy.length}));
