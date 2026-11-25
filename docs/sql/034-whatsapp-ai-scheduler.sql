-- OPTIONAL OPERATOR ACTION AFTER EXPLICIT APPROVAL, never part of migration 034.
-- Separate AI schedule; does not change the existing WhatsApp reporting Cron/Edge.
-- First configure Vault secrets using the Dashboard, never literals in SQL logs:
-- tayo_ai_app_url: verified active application base URL (https://...)
-- tayo_ai_worker_secret: same dedicated >=32-char secret as Vercel
-- WHATSAPP_AI_WORKER_SECRET; MUST differ from CRON_SECRET.
-- Official pattern: https://supabase.com/docs/guides/functions/schedule-functions
begin;
do $$begin
 if to_regclass('cron.job') is null or to_regclass('vault.decrypted_secrets') is null or not exists(select 1 from pg_namespace where nspname='net') then raise exception 'Cron, Vault and pg_net must be available';end if;
 if exists(select 1 from cron.job where jobname='tayo-whatsapp-ai') then raise exception 'AI schedule already exists; inspect, do not duplicate';end if;
 if (select count(*) from vault.decrypted_secrets where name='tayo_ai_app_url' and decrypted_secret like 'https://%')<>1
 or (select count(*) from vault.decrypted_secrets where name='tayo_ai_worker_secret' and length(decrypted_secret)>=32)<>1 then raise exception 'Configure unique AI Vault entries privately first';end if;
end;$$;
select cron.schedule('tayo-whatsapp-ai','30 seconds',$job$
 select net.http_post(
  url:=(select rtrim(decrypted_secret,'/')||'/api/cron/whatsapp-ai' from vault.decrypted_secrets where name='tayo_ai_app_url'),
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='tayo_ai_worker_secret')),
  body:='{}'::jsonb,timeout_milliseconds:=50000);
$job$);
commit;
-- A 503/401 means stop and inspect; never change the reporting Cron to compensate.
