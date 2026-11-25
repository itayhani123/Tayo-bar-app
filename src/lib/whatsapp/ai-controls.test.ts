import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {SupabaseClient} from '@supabase/supabase-js';
import {aiFixture} from './ai-db-fixture';
import {processWhatsAppAi} from './ai-worker';
for(const source of ['020','production'] as const)test(`central controls (${source}) default closed; one-user pilot, owner-only management and report isolation`,async()=>{
 const f=await aiFixture(true,false,source);
 try{
  await f.pg.exec('begin read only');
  const rows=await f.pg.query<{status:string}>(readFileSync('docs/sql/034-whatsapp-ai-verify.sql','utf8'));
  assert.ok(rows.rows.every(r=>r.status!=='FAIL'));await f.pg.exec('rollback');
  assert.equal(await f.rpc('whatsapp_ai_user_active',{p_user:crypto.randomUUID()}),false);
  assert.equal(await f.receive(),false);assert.equal(await f.receive(undefined,f.managerPhone),false);
  const senderBefore=await f.pg.query('select * from whatsapp_attendance_senders order by phone');
  await f.allow(f.phone,f.owner);await f.control(true);
  assert.equal(await f.receive(),true);assert.equal(await f.receive(undefined,f.managerPhone),false);
  await f.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[f.manager]);await f.pg.exec('set role authenticated');
  await assert.rejects(f.rpc('set_whatsapp_ai_control',{p_enabled:false}),/OWNER_REQUIRED/);
  await assert.rejects(f.rpc('set_whatsapp_ai_sender',{p_phone:f.managerPhone,p_user:f.manager,p_enabled:true}),/OWNER_REQUIRED/);
  await assert.rejects(f.rpc('read_whatsapp_ai_admin'),/OWNER_REQUIRED/);
  await assert.rejects(f.pg.query('update whatsapp_ai_control set enabled=true'),/permission denied/);
  await f.pg.exec('reset role');await f.pg.query("select set_config('request.jwt.claim.sub',$1,false)",[f.owner]);await f.pg.exec('set role authenticated');
  const status=await f.rpc('read_whatsapp_ai_admin') as {senders:unknown[]};assert.equal(status.senders.length,1);
  await f.rpc('set_whatsapp_ai_control',{p_enabled:false});
  await f.rpc('set_whatsapp_ai_control',{p_enabled:true,p_phone_id:f.phoneId});
  await f.rpc('set_whatsapp_ai_sender',{p_phone:f.phone,p_user:f.owner,p_enabled:true});
  await f.pg.exec("reset role;select set_config('request.jwt.claim.sub','',false)");
  await f.allow(f.phone,f.owner,false);assert.equal(await f.receive(),false);
  assert.deepEqual(await f.pg.query('select * from whatsapp_attendance_senders order by phone'),senderBefore);
  assert.equal(await f.rpc('receive_whatsapp_attendance',{p_message_id:crypto.randomUUID(),p_phone:f.phone,p_phone_id:f.phoneId,p_text:'הגעה 12:30',p_at:new Date().toISOString()}),true);
 }finally{await f.pg.close();}
});
for(const source of ['020','production'] as const)test(`disable (${source}) while queued/processing/pre-send, including disable then re-enable, prevents new sends`,async t=>{
 const f=await aiFixture(true,true,source);
 let sends=0;
 try{
  await t.test('queued work is invalidated by policy revision',async()=>{
   await f.receive();await f.control(false);assert.equal(await f.claim(),null);await f.control(true);assert.equal(await f.claim(),null);
  });
  await t.test('SQL Editor toggles also increment revision automatically',async()=>{
   await f.receive();const before=(await f.pg.query<{revision:number}>('select revision from whatsapp_ai_control')).rows[0].revision;
   await f.pg.exec('update whatsapp_ai_control set enabled=false;update whatsapp_ai_control set enabled=true');
   assert.equal(Number((await f.pg.query<{revision:number}>('select revision from whatsapp_ai_control')).rows[0].revision),Number(before)+2);
   assert.equal(await f.claim(),null);
  });
  await t.test('an already prepared answer cannot send after off/on',async()=>{
   await f.receive();const job=(await f.claim())!;
   await f.rpc('complete_whatsapp_ai',{p_id:job.id,p_lease:job.lease_token,p_phone_id:f.phoneId,p_answer:'Queued answer'});
   await f.control(false);assert.equal(await f.claim(true),null);
   await f.control(true);assert.equal(await f.claim(true),null);
  });
  await t.test('model already running cannot send after disable',async()=>{
   await f.receive();
   await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async()=>{sends++;return'never';},async()=>{await f.control(false);return'Old answer';});
   assert.equal(sends,0);await f.control(true);assert.equal(await f.claim(),null);
  });
  await t.test('fast re-enable does not revive an old model lease',async()=>{
   await f.receive();
   await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async()=>{sends++;return'never';},async()=>{await f.control(false);await f.control(true);return'Old answer';});
   assert.equal(sends,0);
  });
  await t.test('last authorization check blocks before provider dispatch',async()=>{
   await f.receive();
   const wrapped={rpc(name:string,args:Record<string,unknown>){
    if(name!=='whatsapp_ai_identity'||args.p_status!=='sending')return f.db.rpc(name,args);
    const p=(async()=>{await f.control(false);return await f.db.rpc(name,args);})();return Object.assign(p,{abortSignal:()=>p});
   }} as unknown as SupabaseClient;
   await processWhatsAppAi(wrapped,new AbortController().signal,f.phoneId,async()=>{sends++;return'never';},async()=> 'New answer');
   assert.equal(sends,0);
  });
  await t.test('a request already sent cannot be recalled; its provider ACK survives shutdown',async()=>{
   await f.control(true);await f.receive();
   await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async()=>{sends++;await f.control(false);return'in-flight-provider';},async()=> 'Answer');
   assert.equal(sends,1);
   assert.equal((await f.pg.query<{status:string}>("select status from whatsapp_ai_tasks where provider_message_id='in-flight-provider'")).rows[0].status,'sent');
   assert.equal(await f.claim(true),null);
  });
 }finally{await f.pg.close();}
});
for(const source of ['020','production'] as const)test(`Auth (${source}) ban, soft/hard deletion, missing profile and AI revocation during processing invalidate read/send`,async t=>{
 await t.test('physical deletion is denied by existing report FKs; a deleted unreferenced Auth user is inactive',async()=>{
  const f=await aiFixture(true,true,source);const removed=crypto.randomUUID();
  try{
   await assert.rejects(f.pg.query('delete from auth.users where id=$1',[f.owner]),/foreign key/);
   await f.pg.query('insert into auth.users(id) values($1)',[removed]);
   assert.equal(await f.rpc('whatsapp_ai_user_active',{p_user:removed}),true);
   await f.pg.query('delete from auth.users where id=$1',[removed]);
   assert.equal(await f.rpc('whatsapp_ai_user_active',{p_user:removed}),false);
  }finally{await f.pg.close();}
 });
 for(const change of ['ban','delete','profile','allowlist'] as const){
  await t.test(change,async()=>{
   const f=await aiFixture(true,true,source);let sends=0;
   try{
    await f.receive();
    await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async()=>{sends++;return'never';},async(_db,role,_messages,signal,_client,_propose,_context,reader)=>{
     if(change==='ban')await f.pg.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[f.owner]);
     if(change==='delete')await f.pg.query('update auth.users set deleted_at=now() where id=$1',[f.owner]);
     if(change==='profile')await f.pg.query('delete from profiles where id=$1',[f.owner]);
     if(change==='allowlist')await f.allow(f.phone,f.owner,false);
     await assert.rejects(reader!.read(role,'operations',{start:'2026-01-01',end:'2026-01-02',venueId:null},signal),/DATA_UNAVAILABLE/);
     return 'Must not send';
    });
    assert.equal(sends,0);assert.equal(await f.receive(),false);
   }finally{await f.pg.close();}
  });
 }
});
