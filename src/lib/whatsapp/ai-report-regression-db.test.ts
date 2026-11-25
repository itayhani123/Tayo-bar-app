import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import type {SupabaseClient} from "@supabase/supabase-js";
import {processAttendanceInbox} from "./attendance-worker";
import {EVENT_SELECTION_POLICY,parseEventSelectionButton} from "./event-selection";
import type {AttendanceExtraction} from "@/features/ai-assistant/attendance";

for(const installAI of [false,true])for(const source of ['020','production'] as const)test(`event selection (${source}, 034=${installAI}) reuses legacy inbox/receipts and final confirmation without 029–032`,async t=>{
 const pg=new PGlite();
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table profiles(id uuid primary key,role text not null);create table venues(id uuid primary key,name text not null);
   create table employees(id uuid primary key,full_name text not null,active boolean not null,default_hourly_rate numeric(10,2) not null);
   create table business_settings(key text primary key,numeric_value numeric);
   create table ai_action_audit(actor_id uuid,action text,target_id uuid,outcome text);
   create table app_notifications(role_target text,notification_type text,title text,message text,severity text,entity_type text,entity_id uuid,action_url text,dedupe_key text);
   create unique index on app_notifications(dedupe_key) where dedupe_key is not null;`);
  for(const file of ["002_events","005_event_staffing","019_ai_attendance_import","020_whatsapp_attendance_inbox","021_whatsapp_sender_configuration_repair","022_whatsapp_attendance_bot","023_whatsapp_receipt_created_at","024_whatsapp_attendance_confirmation_ux","025_whatsapp_attendance_buttons_only","026_whatsapp_attendance_reliability","027_inventory","028_inventory_whatsapp"]){await pg.exec(readFileSync(`supabase/migrations/${file}.sql`,"utf8"));}
  const owner=crypto.randomUUID(),venue=crypto.randomUUID(),employee=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID(),unrelated=crypto.randomUUID();
  const phone="972501234567",signal=new AbortController().signal;
  await pg.query("insert into auth.users values($1)",[owner]);await pg.query("insert into profiles values($1,'owner')",[owner]);
  await pg.query("insert into venues values($1,'קסנאדו')",[venue]);await pg.query("insert into employees values($1,'עובד בדיקה',true,60)",[employee]);
  for(const [id,type,client] of [[a,"Brit","לקוח א"],[b,"Brit","לקוח ב"],[unrelated,"Bar Mitzvah","לקוח ג"]])await pg.query("insert into events(id,event_date,start_time,event_type,venue_id,client_name,guest_count,price_per_guest,package_type,payer_type) values($1,'2026-11-17','14:00',$2,$3,$4,100,20,'Basic','client')",[id,type,venue,client]);
  const rpc=async(name:string,args:Record<string,unknown>={})=>{
   assert.match(name,/^[a-z_]+$/);const keys=Object.keys(args);keys.forEach(k=>assert.match(k,/^p_[a-z_]+$/));
   return(await pg.query<{v:unknown}>(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,keys.map(k=>args[k]!==null&&typeof args[k]==="object"&&!['p_ids','p_employees'].includes(k)?JSON.stringify(args[k]):args[k]))).rows[0].v;
  };
  await rpc("configure_whatsapp_attendance_sender",{p_actor:owner,p_phone:phone,p_user:owner,p_enabled:true,p_auto:false});
  const original=(await pg.query<{body:string}>("select prosrc body from pg_proc where oid='execute_whatsapp_attendance_decision(uuid,uuid)'::regprocedure")).rows[0].body;
  const migration=readFileSync("supabase/migrations/033_whatsapp_attendance_event_selection.sql","utf8");
  await pg.exec(migration.replace(/commit;\s*$/,'rollback;'));assert.equal((await pg.query<{id:string|null}>("select to_regprocedure('prepare_whatsapp_event_selection(uuid,uuid,jsonb,jsonb,jsonb,uuid[])')::text id")).rows[0].id,null);
  const preflight=await pg.query<{status:string}>(readFileSync("docs/sql/033-event-selection-preflight.sql","utf8"));assert.ok(preflight.rows.every(r=>r.status==="PASS"));
  await pg.exec(migration);const verified=await pg.query<{status:string}>(readFileSync("docs/sql/033-event-selection-verify.sql","utf8"));assert.ok(verified.rows.every(r=>r.status==="PASS"));await assert.rejects(pg.exec(migration),/already exists/);await pg.exec('rollback');
  await pg.exec('alter table auth.users add column banned_until timestamptz,add column deleted_at timestamptz');
  if(source==='production')await pg.exec(readFileSync('src/lib/whatsapp/fixtures/receive-attendance-production.sql','utf8'));
  if(installAI)await pg.exec(readFileSync('supabase/migrations/034_whatsapp_ai_readonly.sql','utf8'));
  else assert.equal((await pg.query<{v:string|null}>("select to_regclass('whatsapp_ai_tasks')::text v")).rows[0].v,null);
  assert.equal((await pg.query<{body:string}>("select prosrc body from pg_proc where oid='execute_whatsapp_attendance_decision(uuid,uuid)'::regprocedure")).rows[0].body,original);
  await pg.exec('set role anon');await assert.rejects(pg.query("select prepare_whatsapp_event_selection(null,null,null,null,null,null)"),/permission denied/);await pg.exec('reset role');
  const db={rpc:(name:string,args:Record<string,unknown>)=>({abortSignal:async()=>({data:await rpc(name,args),error:null})}),from:(table:string)=>({select:(columns:string)=>{
   assert.ok(['events','profiles','whatsapp_attendance_senders'].includes(table));assert.match(columns,/^[a-z_,]+$/);
   const filters:{key:string;value:unknown;array:boolean}[]=[];
   const run=async(single=false)=>{const result=await pg.query(`select ${columns} from public.${table} where ${filters.map((f,i)=>`${f.key}${f.array?'=any(':'='}$${i+1}${f.array?'::uuid[])':''}`).join(' and ')}`,filters.map(f=>f.value));return{data:single?result.rows[0]:result.rows,error:null};};
   const chain={eq:(key:string,value:unknown)=>{assert.match(key,/^[a-z_]+$/);filters.push({key,value,array:false});return chain;},in:(key:string,value:unknown)=>{assert.equal(key,'id');filters.push({key,value,array:true});return chain;},single:()=>run(true),abortSignal:()=>run()};return chain;
  }})} as unknown as SupabaseClient;
  let input:AttendanceExtraction={venue:"אולם קסאנאדו",eventType:"Brit",clientName:null,day:17,month:11,year:2026,weekday:2,entries:[{name:"עובד בדיקה",direction:"in",time:"12:35",note:null},{name:"עובד בדיקה",direction:"out",time:"16:55",note:null}]};
  let extractions=0;
  const work=()=>processAttendanceInbox(db,signal,{extract:async()=>{extractions++;return input;}});
  const fresh=async()=>{await pg.exec("update whatsapp_attendance_inbox set status='rejected' where status in ('pending','processing','review');update whatsapp_attendance_receipts set status='expired' where status in ('pending','processing')");};
  const begin=async()=>{const msg=crypto.randomUUID();await rpc('receive_whatsapp_attendance',{p_message_id:msg,p_phone:phone,p_phone_id:'test',p_text:'נוכחות בדיקה',p_at:new Date().toISOString()});await work();return(await pg.query<{id:string;preview:Record<string,unknown>;proposal_id:string|null}>("select id,preview,proposal_id from whatsapp_attendance_inbox where provider_message_id=$1",[msg])).rows[0];};
  const deliver=async(id:string,kind:string)=>{const row=(await pg.query<{id:string;message_payload:{policy?:string;parts:string[];buttons:{id:string;title:string}[]}}>("select id,message_payload from whatsapp_attendance_receipts where inbox_id=$1 and kind=$2 order by created_at desc limit 1",[id,kind])).rows[0];const lease=crypto.randomUUID(),provider=crypto.randomUUID();await pg.query("update whatsapp_attendance_receipts set status='processing',lease_token=$2,lease_until=now()+interval '2 minutes' where id=$1",[row.id,lease]);assert.equal(await rpc('ack_whatsapp_attendance_receipt',{p_receipt:row.id,p_lease:lease,p_provider:provider,p_final:true,p_next_index:row.message_payload.parts.length}),true);return{...row,provider};};
  const reply=(id:string,text:string|null,overrides:Record<string,unknown>={})=>rpc('receive_whatsapp_event_selection',{p_message_id:crypto.randomUUID(),p_phone:phone,p_phone_id:'test',p_text:text,p_at:new Date().toISOString(),p_inbox:null,p_token:null,p_event:null,p_action:'select',p_reply_to:null,...overrides});
  await t.test('two real matches -> numbered/button choice -> unchanged explicit confirmation -> one save',async()=>{
   const q=await begin();assert.equal(q.proposal_id,null);const selection=q.preview.eventSelection as {eventIds:string[]};assert.deepEqual(selection.eventIds.sort(),[a,b].sort());assert.ok(!selection.eventIds.includes(unrelated));
   const list=await deliver(q.id,'correction');assert.equal(list.message_payload.policy,EVENT_SELECTION_POLICY);assert.equal(list.message_payload.buttons.length,3);assert.equal((await pg.query<{n:number}>('select count(*) n from event_assignments')).rows[0].n,0);
   const message=crypto.randomUUID();assert.equal(await reply(q.id,'2',{p_message_id:message}),true);assert.equal(await reply(q.id,'2',{p_message_id:message}),true);
   const selected=(await pg.query<{preview:{eventSelection:{eventId:string}}}>("select preview from whatsapp_attendance_inbox where id=$1",[q.id])).rows[0].preview.eventSelection.eventId;
   assert.equal(selected,selection.eventIds[1]);await reply(q.id,'1');assert.equal((await pg.query<{preview:{eventSelection:{eventId:string}}}>('select preview from whatsapp_attendance_inbox where id=$1',[q.id])).rows[0].preview.eventSelection.eventId,selected);const before=extractions;await work();assert.equal(extractions,before);
   const ready=(await pg.query<{status:string;proposal_id:string|null}>("select status,proposal_id from whatsapp_attendance_inbox where id=$1",[q.id])).rows[0];assert.equal(ready.status,'review');assert.ok(ready.proposal_id);assert.equal((await pg.query<{n:number}>('select count(*) n from event_assignments')).rows[0].n,0);
   const summary=await deliver(q.id,'summary');const button=summary.message_payload.buttons.find(x=>x.id.startsWith('attendance:confirm:'))!.id.split(':');
   await rpc('receive_whatsapp_attendance_button',{p_message_id:crypto.randomUUID(),p_phone:phone,p_phone_id:'test',p_inbox:q.id,p_token:button[3],p_decision:'confirm',p_at:new Date().toISOString(),p_reply_to:summary.provider});
   const decision=await rpc('claim_whatsapp_attendance_decision') as {id:string;lease_token:string};const result=await rpc('execute_whatsapp_attendance_decision',{p_id:decision.id,p_lease:decision.lease_token}) as {status:string};assert.equal(result.status,'succeeded');await rpc('execute_whatsapp_attendance_decision',{p_id:decision.id,p_lease:decision.lease_token});
   const saved=(await pg.query<{event_id:string}>('select event_id from event_assignments')).rows;assert.equal(saved.length,1);assert.equal(saved[0].event_id,selected);
  });
  await t.test('invalid number, expiry refresh, old token and cancel never save hours',async()=>{
   await fresh();const q=await begin();const list=await deliver(q.id,'correction');const button=parseEventSelectionButton(list.message_payload.buttons[0].id)!;
   await reply(q.id,'99');assert.equal((await pg.query<{status:string}>('select status from whatsapp_attendance_inbox where id=$1',[q.id])).rows[0].status,'review');
   await pg.query("update whatsapp_attendance_inbox set preview=jsonb_set(preview,'{eventSelection,expiresAt}',to_jsonb((now()-interval '1 minute')::text)) where id=$1",[q.id]);
   await reply(q.id,'1');assert.equal((await pg.query<{status:string}>('select status from whatsapp_attendance_inbox where id=$1',[q.id])).rows[0].status,'pending');await work();await deliver(q.id,'correction');
   await reply(q.id,null,{p_inbox:q.id,p_token:button.token,p_event:button.eventId});assert.equal((await pg.query<{status:string}>('select status from whatsapp_attendance_inbox where id=$1',[q.id])).rows[0].status,'review');
   await reply(q.id,'בטל');assert.equal((await pg.query<{status:string}>('select status from whatsapp_attendance_inbox where id=$1',[q.id])).rows[0].status,'rejected');assert.equal((await pg.query<{n:number}>('select count(*) n from event_assignments')).rows[0].n,1);
  });
  await t.test('multiple active lists require a quoted list; revoked senders cannot choose',async()=>{
   await fresh();const first=await begin();const sent=await deliver(first.id,'correction');const second=await begin();await deliver(second.id,'correction');
   await reply(first.id,'1');assert.equal((await pg.query<{n:number}>("select count(*) n from whatsapp_attendance_inbox where status='pending'")).rows[0].n,0);
   await reply(first.id,'1',{p_reply_to:sent.provider});await reply(second.id,'1');assert.equal((await pg.query<{status:string}>('select status from whatsapp_attendance_inbox where id=$1',[second.id])).rows[0].status,'review');assert.equal((await pg.query<{status:string}>('select status from whatsapp_attendance_inbox where id=$1',[first.id])).rows[0].status,'pending');
   await pg.query('update whatsapp_attendance_senders set enabled=false where phone=$1',[phone]);assert.equal(await reply(second.id,'1'),false);await pg.query('update whatsapp_attendance_senders set enabled=true where phone=$1',[phone]);
  });
  await t.test('button selects a real ID and existing final cancel does not save',async()=>{
   await fresh();const q=await begin();const list=await deliver(q.id,'correction');const selected=parseEventSelectionButton(list.message_payload.buttons[0].id)!;
   await reply(q.id,null,{p_inbox:q.id,p_token:selected.token,p_event:unrelated});assert.equal((await pg.query<{status:string}>('select status from whatsapp_attendance_inbox where id=$1',[q.id])).rows[0].status,'review');
   await reply(q.id,null,{p_inbox:q.id,p_token:selected.token,p_event:selected.eventId});assert.equal((await pg.query<{preview:{eventSelection:{eventId:string}}}>('select preview from whatsapp_attendance_inbox where id=$1',[q.id])).rows[0].preview.eventSelection.eventId,selected.eventId);
   await work();const summary=await deliver(q.id,'summary');const cancel=summary.message_payload.buttons.find(x=>x.id.startsWith('attendance:cancel:'))!.id.split(':');
   await rpc('receive_whatsapp_attendance_button',{p_message_id:crypto.randomUUID(),p_phone:phone,p_phone_id:'test',p_inbox:q.id,p_token:cancel[3],p_decision:'cancel',p_at:new Date().toISOString(),p_reply_to:summary.provider});
   const decision=await rpc('claim_whatsapp_attendance_decision') as {id:string;lease_token:string};assert.equal((await rpc('execute_whatsapp_attendance_decision',{p_id:decision.id,p_lease:decision.lease_token}) as {status:string}).status,'cancelled');assert.equal((await pg.query<{n:number}>('select count(*) n from event_assignments')).rows[0].n,1);
  });
  await t.test('catalog changes invalidate the stored choice snapshot and refresh the list',async()=>{
   await fresh();const q=await begin();const list=await deliver(q.id,'correction');const button=parseEventSelectionButton(list.message_payload.buttons[0].id)!;
   const originalClient=(await pg.query<{client_name:string}>('select client_name from events where id=$1',[button.eventId])).rows[0].client_name;
   await pg.query("update events set client_name='Changed' where id=$1",[button.eventId]);
   await reply(q.id,null,{p_inbox:q.id,p_token:button.token,p_event:button.eventId});
   const state=(await pg.query<{status:string;preview:unknown}>('select status,preview from whatsapp_attendance_inbox where id=$1',[q.id])).rows[0];assert.equal(state.status,'pending');assert.equal(state.preview,null);
   await pg.query('update events set client_name=$2 where id=$1',[button.eventId,originalClient]);assert.equal((await pg.query<{n:number}>('select count(*) n from event_assignments')).rows[0].n,1);
  });
  await t.test('zero matches never displays fallback events; one match uses normal flow',async()=>{
   await fresh();input={...input,venue:'אולם לא קיים'};const missing=await begin();assert.equal((missing.preview.events as unknown[]).length,0);assert.equal(missing.preview.eventSelection,undefined);
   await fresh();input={...input,venue:'קסנאדו',clientName:'לקוח א'};const unique=await begin();assert.equal(unique.preview.eventId,a);assert.equal(unique.preview.eventSelection,undefined);
  });
  assert.equal((await pg.query<{id:string|null}>("select to_regclass('whatsapp_worker_control')::text id")).rows[0].id,null);
 }finally{await pg.close();}
});
