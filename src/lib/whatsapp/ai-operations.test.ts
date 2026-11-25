import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {aiFixture} from './ai-db-fixture';
test('operator emergency stop changes only AI policy/audit and increments revision',async()=>{
 const f=await aiFixture();
 try{
  await f.receive();
  const before=await f.pg.query('select * from event_assignments');
  const inbox=await f.pg.query('select * from whatsapp_attendance_inbox');
  const revision=Number((await f.pg.query<{revision:number}>('select revision from whatsapp_ai_control')).rows[0].revision);
  await f.pg.exec(readFileSync('docs/sql/034-whatsapp-ai-disable.sql','utf8'));
  const control=(await f.pg.query<{enabled:boolean;revision:number}>('select enabled,revision from whatsapp_ai_control')).rows[0];
  assert.equal(control.enabled,false);assert.equal(Number(control.revision),revision+1);assert.equal(await f.claim(),null);
  assert.deepEqual(await f.pg.query('select * from event_assignments'),before);
  assert.deepEqual(await f.pg.query('select * from whatsapp_attendance_inbox'),inbox);
 }finally{await f.pg.close();}
});
test('optional AI scheduler stores only Vault lookups and leaves reporting scheduler untouched (local API stubs)',async()=>{
 const f=await aiFixture();
 try{
  await f.pg.exec(`create schema cron;create schema vault;create schema net;
   create table cron.job(jobid bigint generated always as identity,jobname text,schedule text,command text);
   create table vault.decrypted_secrets(name text,decrypted_secret text);
   create function cron.schedule(text,text,text) returns bigint language plpgsql as $$declare n bigint;begin insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid into n;return n;end$$;
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
   insert into cron.job(jobname,schedule,command) values('whatsapp-notifications','30 seconds','existing-report-command');
   insert into vault.decrypted_secrets values('tayo_ai_app_url','https://synthetic.invalid'),('tayo_ai_worker_secret','synthetic-only-long-private-worker-secret');`);
  await f.pg.exec(readFileSync('docs/sql/034-whatsapp-ai-scheduler.sql','utf8'));
  const jobs=await f.pg.query<{jobname:string;schedule:string;command:string}>('select jobname,schedule,command from cron.job order by jobid');
  assert.equal(jobs.rows.length,2);assert.equal(jobs.rows[0].command,'existing-report-command');
  assert.equal(jobs.rows[1].jobname,'tayo-whatsapp-ai');assert.match(jobs.rows[1].command,/\/api\/cron\/whatsapp-ai/);
  assert.doesNotMatch(jobs.rows[1].command,/synthetic-only-long-private-worker-secret/);
  await f.pg.exec(jobs.rows[1].command); // Stub only: no network call.
  await assert.rejects(f.pg.exec(readFileSync('docs/sql/034-whatsapp-ai-scheduler.sql','utf8')),/already exists/);await f.pg.exec('rollback');
 }finally{await f.pg.close();}
});
