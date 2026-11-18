import test from "node:test";
import assert from "node:assert/strict";
import {PGlite} from "@electric-sql/pglite";
import {readFileSync} from "node:fs";
import type {SupabaseClient} from "@supabase/supabase-js";
import {previewAttendance} from "./attendance-service";
import {processInventoryReport} from "@/features/inventory/whatsapp";
import {inventoryExtractionSchema,INVENTORY_POLICY} from "@/features/inventory/domain";

test("hotfix runs on legacy catalogs without 029/031/032 and preserves confirmation-only writes",async()=>{
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
  for(const name of ["002_events","005_event_staffing","019_ai_attendance_import","020_whatsapp_attendance_inbox","021_whatsapp_sender_configuration_repair","022_whatsapp_attendance_bot","023_whatsapp_receipt_created_at","024_whatsapp_attendance_confirmation_ux","025_whatsapp_attendance_buttons_only","026_whatsapp_attendance_reliability","027_inventory","028_inventory_whatsapp","030_inventory_schema_alignment"]){
   await pg.exec(readFileSync(`supabase/migrations/${name}.sql`,"utf8"));
  }
  const owner=crypto.randomUUID(),venue=crypto.randomUUID(),employee=crypto.randomUUID(),brit=crypto.randomUUID(),bar=crypto.randomUUID();
  await pg.query("insert into auth.users values($1)",[owner]);await pg.query("insert into profiles values($1,'owner')",[owner]);
  await pg.query("insert into venues values($1,'אפטאון')",[venue]);await pg.query("insert into employees values($1,'עובד בדיקה',true,60)",[employee]);
  for(const [id,type,time] of [[brit,"Brit","14:00"],[bar,"Bar Mitzvah","19:30"]])await pg.query("insert into events(id,event_date,start_time,event_type,venue_id,client_name,guest_count,price_per_guest,package_type,payer_type) values($1,'2026-11-17',$2,$3,$4,'כהן',100,20,'Basic','client')",[id,time,type,venue]);
  const rpc=async(name:string,args:Record<string,unknown>)=>{
   assert.ok(["ai_attendance_catalog","ai_attendance_snapshot","register_ai_attendance","inventory_save_product","inventory_catalog","inventory_prepare","inventory_confirm","configure_whatsapp_attendance_sender","inventory_set_receipt_permission","receive_inventory_whatsapp","claim_whatsapp_attendance","prepare_inventory_whatsapp","inventory_overview"].includes(name));
   const keys=Object.keys(args);return (await pg.query<{v:unknown}>(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,keys.map(k=>k!=="p_employees"&&args[k]!==null&&typeof args[k]==="object"?JSON.stringify(args[k]):args[k]))).rows[0].v;
  };
  const calls:string[]=[];
  const db={rpc:(name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{calls.push(name);return {data:await rpc(name,args),error:null};}}),from:(table:string)=>{
   assert.equal(table,"events");return {select:(columns:string)=>{assert.equal(columns,"id,event_type");return {in:(key:string,ids:string[])=>{assert.equal(key,"id");return {abortSignal:async()=>{await pg.exec("set role service_role");try{return {data:(await pg.query("select id,event_type from events where id=any($1::uuid[])",[ids])).rows,error:null};}finally{await pg.exec("reset role");}}};}};}};
  }} as unknown as SupabaseClient;
  const extracted={venue:"ברית באפטאון",day:17,month:11,year:2026,weekday:2,clientName:"כהן",entries:[{name:"עובד בדיקה",direction:"in" as const,time:"12:35",note:null},{name:"עובד בדיקה",direction:"out" as const,time:"16:55",note:null}]};
  const preview=await previewAttendance(db,owner,"owner",extracted,undefined,true,new AbortController().signal);
  assert.equal(preview.eventId,brit);assert.ok(preview.proposalId);assert.equal((await pg.query<{n:number}>("select count(*) n from event_assignments")).rows[0].n,0);
  const ambiguous=await previewAttendance(db,owner,"owner",{...extracted,venue:"אפטאון",clientName:null},undefined,true,new AbortController().signal);
  assert.equal(ambiguous.eventId,null);assert.equal(ambiguous.proposalId,undefined);
  const wrong=await previewAttendance(db,owner,"owner",{...extracted,eventType:"Bar Mitzvah"},{eventId:bar,rows:[]},true,new AbortController().signal);
  assert.equal(wrong.eventId,null);assert.equal(wrong.proposalId,undefined);
  const product=await rpc("inventory_save_product",{p_actor:owner,p_id:null,p_values:{name:"גרייגוס",category:"וודקה",bottle_ml:750,cost_agorot:"12500",minimum_qty:0,active:true,aliases:[]}});
  const phone="972501234567";await rpc("configure_whatsapp_attendance_sender",{p_actor:owner,p_phone:phone,p_user:owner,p_enabled:true,p_auto:false});
  await rpc("inventory_set_receipt_permission",{p_actor:owner,p_phone:phone,p_enabled:true});
  await rpc("receive_inventory_whatsapp",{p_message_id:crypto.randomUUID(),p_phone:phone,p_phone_id:"test",p_text:"התקבלו למלאי 70 בקבוקי גרייגוס",p_at:new Date().toISOString()});
  const job=await rpc("claim_whatsapp_attendance",{p_receipt:false}) as {id:string;lease_token:string};
  const input=inventoryExtractionSchema.parse({kind:"receipt",venue:null,day:null,month:null,year:null,entries:[{name:"בקבוקי גרייגוס",quantity:70}]});
  const model={responses:{create:async()=>({status:"completed",output_text:JSON.stringify(input)})}} as unknown as Parameters<typeof processInventoryReport>[3];
  assert.equal(await processInventoryReport(db,{...job,actor_id:owner,message_text:"התקבלו למלאי 70 בקבוקי גרייגוס"},new AbortController().signal,model),true);
  assert.equal(INVENTORY_POLICY,"inventory_bottles_v1");
  assert.equal((await pg.query<{stock_qty:number}>("select stock_qty from inventory_products where id=$1",[product])).rows[0].stock_qty,0);
  assert.equal((await pg.query<{n:number}>("select count(*) n from inventory_movements")).rows[0].n,0);
  assert.equal((await pg.query<{id:string|null}>("select to_regprocedure('enter_whatsapp_worker()') id")).rows[0].id,null);
  assert.ok(!calls.some(c=>/enter_whatsapp_worker|leave_whatsapp_worker/.test(c)));
 }finally{await pg.close();}
});
