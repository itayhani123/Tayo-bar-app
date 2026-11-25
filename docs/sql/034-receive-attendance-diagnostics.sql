-- READ ONLY. One result row; metadata/source only, no message/user/business rows.
-- Run the entire statement in Supabase SQL Editor; do not install 034 yet.
-- Reviewed Production body_md5: 25e1b9ed098814007e3e35fc33b1724a (return false at cap).
-- 034 also supports original 020: b68c2839dbf100c5da47bcca8a0c0be2 (raise at cap).
-- A hash alone cannot establish behavioral compatibility or identify its author.
WITH target AS (
 SELECT to_regprocedure('public.receive_whatsapp_attendance(text,text,text,text,timestamptz)') AS oid
), metadata AS (
 SELECT p.*, l.lanname
 FROM target t LEFT JOIN pg_proc p ON p.oid=t.oid
 LEFT JOIN pg_language l ON l.oid=p.prolang
)
SELECT
 CASE WHEN p.oid IS NULL THEN 'MISSING' ELSE 'FOUND' END AS status,
 'public.receive_whatsapp_attendance(text,text,text,text,timestamptz)' AS requested_signature,
 pg_get_functiondef(p.oid) AS function_definition,
 p.prosrc AS function_body,
 md5(btrim(replace(p.prosrc,chr(13),''),chr(32)||chr(9)||chr(10))) AS body_md5,
 'b68c2839dbf100c5da47bcca8a0c0be2' AS expected_020_body_md5,
 pg_get_function_arguments(p.oid) AS arguments,
 pg_get_function_result(p.oid) AS result_type,
 p.lanname AS language,
 CASE WHEN p.oid IS NULL THEN NULL WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security_mode,
 p.proconfig AS function_settings,
 p.provolatile AS volatility,
 p.proisstrict AS strict,
 p.proleakproof AS leakproof,
 p.proparallel AS parallel_mode,
 pg_get_userbyid(p.proowner) AS function_owner,
 p.proacl::text AS explicit_acl,
 (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
   'grantor',pg_get_userbyid(a.grantor),
   'privilege',a.privilege_type,'grantable',a.is_grantable
 ) ORDER BY a.grantee,a.privilege_type),'[]'::jsonb)
 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid IS NOT NULL) AS effective_acl,
 (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'role',r.rolname,'can_execute',has_function_privilege(r.oid,p.oid,'EXECUTE')
 ) ORDER BY r.rolname),'[]'::jsonb)
 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role') AND p.oid IS NOT NULL) AS role_execution,
 (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'signature',o.oid::regprocedure::text,'kind',o.prokind
 ) ORDER BY o.oid::regprocedure::text),'[]'::jsonb)
 FROM pg_proc o JOIN pg_namespace n ON n.oid=o.pronamespace
 WHERE n.nspname='public' AND o.proname='receive_whatsapp_attendance') AS same_name_definitions
FROM metadata p;
