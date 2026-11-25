import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {aiFixture} from './ai-db-fixture';
import {handleMetaWebhook} from './webhook';
import {handleWhatsAppAiWorker} from './ai-worker-http';
import {whatsappAiEnabled} from './ai-routing';

for(const flag of [undefined,'false'])test(`release disabled=${String(flag)} works without 034, provider keys or AI secret`,async()=>{
 const names=['WHATSAPP_AI_FALLBACK_ENABLED','WHATSAPP_AI_WORKER_SECRET','WHATSAPP_AI_OPENAI_API_KEY','OPENAI_API_KEY'];
 const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const f=await aiFixture(false,true,'production'),fetchBefore=globalThis.fetch;
 const calls:string[]=[];let fetches=0;
 try{
  for(const n of names)delete process.env[n];if(flag!==undefined)process.env.WHATSAPP_AI_FALLBACK_ENABLED=flag;
  assert.equal(whatsappAiEnabled(),false);
  globalThis.fetch=async()=>{fetches++;throw Error('Unexpected network/model request');};
  const db={rpc(name:string,args:Record<string,unknown>){calls.push(name);assert.ok(!name.includes('_ai'));return f.db.rpc(name,args);}} as unknown as SupabaseClient;
  // An existing pending confirmation is preserved when a clear question arrives.
  await f.rpc('receive_whatsapp_attendance',{p_message_id:'pending',p_phone:f.phone,p_phone_id:f.phoneId,p_text:'Synthetic report',p_at:new Date().toISOString()});
  await f.pg.exec("update whatsapp_attendance_inbox set status='review',preview='{\"pending\":true}',confirmation_token=gen_random_uuid(),confirmation_expires_at=now()+interval '10 minutes' where provider_message_id='pending'");
  const pending=await f.pg.query("select * from whatsapp_attendance_inbox where provider_message_id='pending'");
  const messages=['מי עובד מחר?','הגעה 12:30 יציאה 16:55','התקבלו למלאי 2 בקבוקי גרייגוס'];
  const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:f.phoneId},messages:messages.map((body,i)=>({id:'inbound-'+i,from:f.phone,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body}}))}}]}]});
  const req=()=>new Request('https://tayo.test/api/webhooks/whatsapp',{method:'POST',body:raw,headers:{'x-hub-signature-256':'sha256='+createHmac('sha256','synthetic-secret').update(raw).digest('hex')}});
  assert.equal((await handleMetaWebhook(req(),()=>db,{secret:'synthetic-secret',phoneId:f.phoneId})).status,200);
  assert.equal((await handleMetaWebhook(req(),()=>db,{secret:'synthetic-secret',phoneId:f.phoneId})).status,200);
  assert.deepEqual(calls,['receive_whatsapp_attendance','receive_whatsapp_attendance','receive_inventory_whatsapp','receive_whatsapp_attendance','receive_whatsapp_attendance','receive_inventory_whatsapp']);
  assert.deepEqual(await f.pg.query("select * from whatsapp_attendance_inbox where provider_message_id='pending'"),pending);
  assert.equal((await f.pg.query<{n:number}>('select count(*)::int n from whatsapp_attendance_inbox')).rows[0].n,4);
  // Direct invocation cannot touch a database/provider when disabled, with or without keys.
  let opened=0;const secret='dedicated-ai-worker-secret'.repeat(2);
  const deps={enabled:false,db:()=>{opened++;throw Error('Forbidden DB creation');},send:async()=>{throw Error('Forbidden send');}};
  assert.equal((await handleWhatsAppAiWorker(new Request('https://tayo.test/api/cron/whatsapp-ai',{method:'POST'}),deps)).status,503);
  const off=await handleWhatsAppAiWorker(new Request('https://tayo.test/api/cron/whatsapp-ai',{method:'POST',headers:{authorization:'Bearer '+secret}}),{...deps,secret,reportingSecret:'reporting-only'});
  assert.deepEqual(await off.json(),{processed:0,disabled:true});assert.equal(opened,0);assert.equal(fetches,0);
  assert.equal((await f.pg.query<{v:string|null}>("select to_regclass('whatsapp_ai_tasks')::text v")).rows[0].v,null);
  assert.equal((await f.pg.query<{n:number}>("select count(*)::int n from pg_proc where pronamespace='public'::regnamespace and proname='receive_whatsapp_ai'")).rows[0].n,0);
 }finally{
  globalThis.fetch=fetchBefore;for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}await f.pg.close();
 }
});

test('inventory v1 keeps cancel/confirm/replay and stock safety on Production definition without 034',async()=>{
 const f=await aiFixture(false,true,'production');
 try{
  await f.rpc('inventory_set_receipt_permission',{p_actor:f.owner,p_phone:f.phone,p_enabled:true});
  const product=await f.rpc('inventory_save_product',{p_actor:f.owner,p_id:null,p_values:{name:'Synthetic product',category:'Synthetic',bottle_ml:1000,cost_agorot:'12500',minimum_qty:0,active:true,aliases:[]}});
  for(const [kind,decision,quantity] of [['receipt','cancel',3],['receipt','confirm',3],['consumption','confirm',1]] as const){
   await f.rpc('receive_inventory_whatsapp',{p_message_id:crypto.randomUUID(),p_phone:f.phone,p_phone_id:f.phoneId,p_text:'Synthetic inventory',p_at:new Date().toISOString()});
   const q=await f.rpc('claim_whatsapp_attendance',{p_receipt:false}) as {id:string;lease_token:string};
   const stock=(await f.pg.query<{stock_qty:number}>('select stock_qty from inventory_products where id=$1',[product])).rows[0].stock_qty;
   await f.rpc('prepare_inventory_whatsapp',{p_actor:f.owner,p_inbox:q.id,p_lease:q.lease_token,p_kind:kind,p_event:kind==='consumption'?f.event:null,p_lines:[{product_id:product,quantity}],p_summary:'Synthetic'});
   assert.equal((await f.pg.query<{stock_qty:number}>('select stock_qty from inventory_products where id=$1',[product])).rows[0].stock_qty,stock);
   const receipt=(await f.pg.query<{id:string;message_payload:{policy:string}}>("select id,message_payload from whatsapp_attendance_receipts where inbox_id=$1 and kind='summary'",[q.id])).rows[0];
   assert.equal(receipt.message_payload.policy,'inventory_bottles_v1');const lease=crypto.randomUUID();
   await f.pg.query("update whatsapp_attendance_receipts set status='processing',lease_token=$2,lease_until=now()+interval '2 minutes' where id=$1",[receipt.id,lease]);
   await f.rpc('ack_whatsapp_attendance_receipt',{p_receipt:receipt.id,p_lease:lease,p_provider:'summary-'+q.id,p_final:true,p_next_index:1});
   const token=(await f.pg.query<{confirmation_token:string}>('select confirmation_token from whatsapp_attendance_inbox where id=$1',[q.id])).rows[0].confirmation_token;
   await f.rpc('receive_whatsapp_attendance_button',{p_message_id:crypto.randomUUID(),p_phone:f.phone,p_phone_id:f.phoneId,p_inbox:q.id,p_token:token,p_decision:decision,p_at:new Date().toISOString(),p_reply_to:'summary-'+q.id});
   const d=await f.rpc('claim_whatsapp_attendance_decision') as {id:string;lease_token:string};
   const result=await f.rpc('execute_whatsapp_attendance_decision',{p_id:d.id,p_lease:d.lease_token});
   assert.deepEqual(await f.rpc('execute_whatsapp_attendance_decision',{p_id:d.id,p_lease:d.lease_token}),result);
   assert.equal((await f.pg.query<{stock_qty:number}>('select stock_qty from inventory_products where id=$1',[product])).rows[0].stock_qty,stock+(decision==='cancel'?0:kind==='receipt'?quantity:-quantity));
  }
  await assert.rejects(f.rpc('inventory_prepare',{p_actor:f.owner,p_kind:'consumption',p_event:f.event,p_lines:[{product_id:product,quantity:100}],p_key:crypto.randomUUID(),p_reason:null,p_inbox:null}),/INSUFFICIENT/);
  assert.equal((await f.pg.query<{v:string|null}>("select to_regclass('whatsapp_ai_control')::text v")).rows[0].v,null);
 }finally{await f.pg.close();}
});
