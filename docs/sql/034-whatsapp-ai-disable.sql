-- OPERATOR EMERGENCY ACTION, NOT A PREFLIGHT. Do not run without approval.
-- Disables only AI. No Worker, Cron, attendance or inventory configuration changes.
begin;
set local lock_timeout='2s';
set local statement_timeout='5s';
select set_config('request.jwt.claim.sub','',true);
update public.whatsapp_ai_control set enabled=false where singleton;
-- The trigger increments policy revision and audits this change automatically.
commit;
select enabled,revision from public.whatsapp_ai_control where singleton;
