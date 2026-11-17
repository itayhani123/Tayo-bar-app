import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {inventoryOverviewSchema} from "./contract";
const owner="11111111-1111-4111-8111-111111111111",manager="22222222-2222-4222-8222-222222222222",event="33333333-3333-4333-8333-333333333333",venue="44444444-4444-4444-8444-444444444444";
test("inventory PostgreSQL: exact money, roles, ledger, atomic multi-product confirmation, reversal and shared WhatsApp queues",async t=>{
 const pg=new PGlite();try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table profiles(id uuid primary key,role text);create table venues(id uuid primary key,name text);create table employees(id uuid primary key,full_name text,active boolean,default_hourly_rate numeric);create table business_settings(key text primary key,numeric_value numeric);create table ai_action_audit(actor_id uuid,action text,target_id uuid,outcome text);insert into auth.users values('${owner}'),('${manager}');insert into profiles values('${owner}','owner'),('${manager}','manager');insert into venues values('${venue}','אפטאון');`);
  await pg.exec("create table app_notifications(role_target text,notification_type text,title text,message text,severity text,entity_type text,entity_id uuid,action_url text,dedupe_key text);create unique index on app_notifications(dedupe_key) where dedupe_key is not null;grant select on app_notifications to service_role");
  for(const f of ["002_events.sql","005_event_staffing.sql","019_ai_attendance_import.sql","020_whatsapp_attendance_inbox.sql","021_whatsapp_sender_configuration_repair.sql","022_whatsapp_attendance_bot.sql","023_whatsapp_receipt_created_at.sql","024_whatsapp_attendance_confirmation_ux.sql","025_whatsapp_attendance_buttons_only.sql","026_whatsapp_attendance_reliability.sql","027_inventory.sql","028_inventory_whatsapp.sql"])await pg.exec(readFileSync(`supabase/migrations/${f}`,"utf8"));
  await pg.exec(readFileSync("supabase/migrations/029_inventory_failure_feedback.sql","utf8"));
  // Reproduce the deployed 027 variant: tables exist but preview snapshots do not.
  await pg.exec("alter table inventory_reports drop column preview_costs;alter table inventory_reports drop column event_snapshot");
  const alignment=readFileSync("supabase/migrations/030_inventory_schema_alignment.sql","utf8");
  await pg.exec(alignment);await pg.exec(alignment);
  await pg.query("insert into events(id,event_date,start_time,event_type,venue_id,client_name,guest_count,price_per_guest,package_type,payer_type) values($1,'2026-11-15','12:30','Wedding',$2,'מעיין',100,20,'Basic','client')",[event,venue]);
  await pg.exec("grant usage on schema public,auth to service_role,authenticated;grant select,update(id) on profiles to service_role;grant select on profiles to authenticated;grant select on events,venues to service_role;set role service_role");
  async function rpc<T=unknown>(name:string,args:Record<string,unknown>){const vals=Object.values(args).map(v=>v&&typeof v==="object"?JSON.stringify(v):v);return(await pg.query<{v:T}>(`select ${name}(${Object.keys(args).map((key,i)=>`${key}=>$${i+1}`).join(",")}) v`,vals)).rows[0].v;}
  const product=(name:string,cost:string,actor=owner,id:string|null=null)=>rpc<string>("inventory_save_product",{p_actor:actor,p_id:id,p_values:{name,category:"אלכוהול",bottle_ml:750,cost_agorot:cost,minimum_qty:3,active:true,aliases:[]}});
  const prepare=(kind:string,lines:{product_id:string;quantity:number}[],actor=owner,eventId:string|null=null)=>rpc<string>("inventory_prepare",{p_actor:actor,p_kind:kind,p_event:eventId,p_lines:lines,p_key:crypto.randomUUID(),p_reason:kind==="adjustment"?"ספירה":null});
  const confirm=(id:string,actor=owner)=>rpc<{status:string;replayed?:boolean}>("inventory_confirm",{p_actor:actor,p_report:id});
  const stock=async(id:string)=>Number((await pg.query<{stock_qty:number}>("select stock_qty from inventory_products where id=$1",[id])).rows[0].stock_qty);
  const emptyOverview=inventoryOverviewSchema.parse(await rpc("inventory_overview",{p_actor:owner}));assert.deepEqual(emptyOverview.products,[]);assert.deepEqual(emptyOverview.inbox,[]);
  const grey=await product("גרייגוס","9000"),james=await product("ג'יימסון","7500"),arak=await product("ערק","4500");
  assert.equal(inventoryOverviewSchema.parse(await rpc("inventory_overview",{p_actor:manager})).products.length,3);
  await t.test("owner-only prices and direct balance edits denied; central receipt requires a ledger",async()=>{
   await assert.rejects(product("אסור","100",manager),/INVENTORY_FORBIDDEN/);
   await assert.rejects(pg.query("update inventory_products set stock_qty=99 where id=$1",[grey]),/INVENTORY_LEDGER_REQUIRED/);
   await assert.rejects(prepare("receipt",[{product_id:grey,quantity:10}],manager),/INVENTORY_FORBIDDEN/);
   const r=await prepare("receipt",[{product_id:grey,quantity:20},{product_id:james,quantity:20},{product_id:arak,quantity:20}]);assert.equal(await stock(grey),0);assert.equal((await confirm(r)).status,"succeeded");assert.equal(await stock(grey),20);
  });
  let report:string;
  await t.test("approved consumption snapshots 67500 agorot, combines products and is idempotent",async()=>{
   report=await prepare("consumption",[{product_id:grey,quantity:4},{product_id:james,quantity:3},{product_id:arak,quantity:2}],manager,event);
   assert.equal(await stock(grey),20);assert.equal((await confirm(report,manager)).status,"succeeded");assert.equal((await confirm(report,manager)).replayed,true);assert.equal(await stock(grey),16);
   const costs=await rpc<{event_id:string;cost_agorot:string}[]>("inventory_event_costs",{p_actor:owner,p_events:`{${event}}`});assert.equal(costs[0].cost_agorot,"67500");
   await product("גרייגוס","12000",owner,grey);assert.equal((await rpc<{cost_agorot:string}[]>("inventory_event_costs",{p_actor:owner,p_events:`{${event}}` }))[0].cost_agorot,"67500");
   const data=await rpc<{products:Record<string,unknown>[];movements:Record<string,unknown>[];reports:Record<string,unknown>[]}>("inventory_overview",{p_actor:manager});assert.ok(data.products.every(p=>!("cost_agorot"in p)&&!("value_agorot"in p)));assert.ok(data.movements.every(m=>!("unit_cost_agorot"in m)&&!("total_cost_agorot"in m)));assert.ok(data.reports.every(r=>!("preview_costs"in r)));
  });
  await t.test("competing prepared reports recheck stock; no partial rows, no negative balances",async()=>{
   const a=await prepare("consumption",[{product_id:grey,quantity:15}],manager,event),b=await prepare("consumption",[{product_id:grey,quantity:15},{product_id:arak,quantity:2}],manager,event);
   assert.equal((await confirm(a,manager)).status,"succeeded");assert.equal((await confirm(b,manager)).status,"insufficient_stock");assert.equal(await stock(grey),1);assert.equal(await stock(arak),18);
   assert.equal((await pg.query<{n:number}>("select count(*)::int n from inventory_movements where report_id=$1",[b])).rows[0].n,0);
   assert.equal((await pg.query<{n:number}>("select count(*)::int n from app_notifications where notification_type='inventory_low' and role_target='owner'")).rows[0].n,1);
  });
  await t.test("failure in last movement rolls back preceding movements and balances",async()=>{
   const r=await prepare("receipt",[{product_id:grey,quantity:5},{product_id:arak,quantity:5}]);
   await pg.exec(`reset role;create function fail_inventory() returns trigger language plpgsql as $$begin if new.product_id='${arak}' then raise exception 'test failure';end if;return new;end$$;create trigger fail_inventory before insert on inventory_movements for each row execute function fail_inventory();set role service_role`);
   await assert.rejects(confirm(r),/test failure/);assert.equal(await stock(grey),1);assert.equal(await stock(arak),18);
   await pg.exec("reset role;drop trigger fail_inventory on inventory_movements;drop function fail_inventory();set role service_role");
  });
  await t.test("cancellation, unknown references, fractional quantities and corrections retain all history",async()=>{
   const r=await prepare("receipt",[{product_id:grey,quantity:2}]);await rpc("inventory_cancel",{p_actor:owner,p_report:r});assert.equal((await confirm(r)).status,"cancelled");
   await assert.rejects(prepare("consumption",[{product_id:grey,quantity:1}],manager,crypto.randomUUID()),/INVENTORY_EVENT_NOT_FOUND/);
   await assert.rejects(prepare("receipt",[{product_id:crypto.randomUUID(),quantity:1}]),/INVENTORY_PRODUCT_NOT_FOUND/);
   await assert.rejects(prepare("receipt",[{product_id:grey,quantity:1.5}]),/INVENTORY_INVALID_QUANTITY/);
   const movement=(await pg.query<{id:string}>("select id from inventory_movements where report_id=$1 and product_id=$2",[report,arak])).rows[0].id;
   await rpc("inventory_reverse",{p_actor:owner,p_movement:movement,p_key:crypto.randomUUID(),p_reason:"תיקון ספירה"});assert.equal(await stock(arak),20);
   await rpc("inventory_reverse",{p_actor:owner,p_movement:movement,p_key:crypto.randomUUID(),p_reason:"ניסיון חוזר"});assert.equal(await stock(arak),20);
   assert.equal((await rpc<{cost_agorot:string}[]>("inventory_event_costs",{p_actor:owner,p_events:`{${event}}`}))[0].cost_agorot,"238500");
   const received=await prepare("receipt",[{product_id:grey,quantity:1}]);await product("גרייגוס","12001",owner,grey);await confirm(received);
   assert.equal(String((await pg.query<{unit_cost_agorot:string}>("select unit_cost_agorot from inventory_movements where report_id=$1",[received])).rows[0].unit_cost_agorot),"12001");
   await assert.rejects(pg.query("delete from inventory_movements where id=$1",[movement]),/permission denied|IMMUTABLE/);
  });
  await t.test("same signed WhatsApp infrastructure confirms inventory and explicitly gates receiving permissions",async()=>{
   const phone="972501234567";await rpc("configure_whatsapp_attendance_sender",{p_actor:owner,p_phone:phone,p_user:manager,p_enabled:true,p_auto:false});
   const intake=async(id:string,kind="consumption")=>{
    await rpc("receive_inventory_whatsapp",{p_message_id:id,p_phone:phone,p_phone_id:"phone",p_text:"צריכת אלכוהול",p_at:new Date().toISOString()});
    const job=await rpc<{id:string;lease_token:string;report_type:string}>("claim_whatsapp_attendance",{p_receipt:false});assert.equal(job.report_type,"inventory");
    const prepared=()=>rpc("prepare_inventory_whatsapp",{p_actor:manager,p_inbox:job.id,p_lease:job.lease_token,p_kind:kind,p_event:kind==="consumption"?event:null,p_lines:[{product_id:james,quantity:1}],p_summary:"סיכום מלאי"});
    return{job,prepared};
   };
   const {job,prepared}=await intake("inventory-one");await prepared();assert.equal(await stock(james),17);
   assert.equal((await confirm(job.id,manager)).status,"forbidden");assert.equal(await stock(james),17);
   const q=(await pg.query<{confirmation_token:string}>("select confirmation_token from whatsapp_attendance_inbox where id=$1",[job.id])).rows[0];
   const receipt=await rpc<{id:string;lease_token:string}>("claim_whatsapp_attendance",{p_receipt:true});assert.ok(receipt);
   await rpc("ack_whatsapp_attendance_receipt",{p_receipt:receipt.id,p_lease:receipt.lease_token,p_provider:"meta-inventory",p_final:true,p_next_index:1});
   await rpc("receive_whatsapp_attendance_button",{p_message_id:"inventory-click",p_phone:phone,p_phone_id:"phone",p_inbox:job.id,p_token:q.confirmation_token,p_decision:"confirm",p_at:new Date().toISOString(),p_reply_to:"meta-inventory"});
   const d=await rpc<{id:string;lease_token:string}>("claim_whatsapp_attendance_decision",{});const result=await rpc<{status:string}>("execute_whatsapp_attendance_decision",{p_id:d.id,p_lease:d.lease_token});assert.equal(result.status,"succeeded");assert.equal(await stock(james),16);
   assert.equal((await rpc<{status:string}>("execute_whatsapp_attendance_decision",{p_id:d.id,p_lease:d.lease_token})).status,"succeeded");assert.equal(await stock(james),16);
   const receiving=await intake("inventory-receive","receipt");await assert.rejects(receiving.prepared(),/INVENTORY_RECEIPT_PERMISSION/);await rpc("inventory_set_receipt_permission",{p_actor:owner,p_phone:phone,p_enabled:true});await receiving.prepared();
   await assert.rejects(product("שינוי אסור","1",manager,james),/INVENTORY_FORBIDDEN/);
   const ack=async(id:string)=>{
    await pg.query("update whatsapp_attendance_receipts set status='processing',lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes' where inbox_id=$1 and kind='summary'",[id]);
    await pg.query("select ack_whatsapp_attendance_receipt(id,lease_token,$2,true,1) from whatsapp_attendance_receipts where inbox_id=$1 and kind='summary'",[id,`meta-${id}`]);
   };
   const click=async(id:string,action="confirm")=>{
    const token=(await pg.query<{confirmation_token:string}>("select confirmation_token from whatsapp_attendance_inbox where id=$1",[id])).rows[0].confirmation_token;
    await rpc("receive_whatsapp_attendance_button",{p_message_id:crypto.randomUUID(),p_phone:phone,p_phone_id:"phone",p_inbox:id,p_token:token,p_decision:action,p_at:new Date().toISOString(),p_reply_to:`meta-${id}`});
    const decision=await rpc<{id:string;lease_token:string}>("claim_whatsapp_attendance_decision",{});return rpc<{status:string}>("execute_whatsapp_attendance_decision",{p_id:decision.id,p_lease:decision.lease_token});
   };
   await ack(receiving.job.id);await rpc("inventory_set_receipt_permission",{p_actor:owner,p_phone:phone,p_enabled:false});assert.equal((await click(receiving.job.id)).status,"forbidden");assert.equal(await stock(james),16);
   await rpc("inventory_set_receipt_permission",{p_actor:owner,p_phone:phone,p_enabled:true});const allowed=await intake("inventory-receive-allowed","receipt");await allowed.prepared();await ack(allowed.job.id);assert.equal((await click(allowed.job.id)).status,"succeeded");assert.equal(await stock(james),17);
   const cancelled=await intake("inventory-cancel");await cancelled.prepared();await ack(cancelled.job.id);assert.equal((await click(cancelled.job.id,"cancel")).status,"cancelled");assert.equal(await stock(james),17);
   await rpc("receive_whatsapp_attendance",{p_message_id:"attendance-regression",p_phone:phone,p_phone_id:"phone",p_text:"הגעה",p_at:new Date().toISOString()});
   const attendance=await rpc<{id:string;lease_token:string;report_type:string}>("claim_whatsapp_attendance",{p_receipt:false});assert.equal(attendance.report_type,"attendance");
   await rpc("complete_whatsapp_attendance_analysis",{p_inbox:attendance.id,p_lease:attendance.lease_token,p_extracted:{},p_preview:{confirmationPolicy:"buttons_attendance_v2",rows:[],issues:["נדרשים פרטי נוכחות"]},p_parts:["נדרשים פרטי נוכחות"]});
   await ack(attendance.id);assert.equal((await click(attendance.id,"cancel")).status,"cancelled");assert.equal(await stock(james),17);
   for(const [rpcName,messageId,expected]of[["receive_inventory_whatsapp","inventory-failure",/דיווח המלאי/],["receive_whatsapp_attendance","attendance-failure",/לא נשמרו שעות/]] as const){
    await rpc(rpcName,{p_message_id:messageId,p_phone:phone,p_phone_id:"phone",p_text:"בדיקת כשל",p_at:new Date().toISOString()});
    const failed=await rpc<{id:string;lease_token:string}>("claim_whatsapp_attendance",{p_receipt:false});
    await pg.query("update whatsapp_attendance_inbox set status='failed',error_code='PROCESSING_FAILED' where id=$1",[failed.id]);
    await rpc("queue_whatsapp_attendance_failure",{p_inbox:failed.id,p_lease:failed.lease_token});
    const feedback=await pg.query<{body:string}>("select body from whatsapp_attendance_receipts where inbox_id=$1 and kind='failure'",[failed.id]);
    assert.equal(feedback.rows.length,1);assert.match(feedback.rows[0].body,expected);
    if(rpcName==="receive_inventory_whatsapp")assert.doesNotMatch(feedback.rows[0].body,/שעות|נוכחות/);
   }
   await pg.exec("reset role;set role authenticated;select set_config('request.jwt.claim.sub','"+manager+"',false)");assert.equal((await pg.query("select * from inventory_products")).rows.length,0);
   await assert.rejects(pg.query("select inventory_save_product($1,null,'{}')",[owner]),/permission denied/);
   await assert.rejects(pg.query("update inventory_products set cost_agorot=1"),/permission denied/);
   await assert.rejects(pg.query("select read_inventory_event_costs($1)",[`{${event}}`]),/INVENTORY_FORBIDDEN/);
   await pg.exec("select set_config('request.jwt.claim.sub','"+owner+"',false)");assert.equal((await pg.query("select * from inventory_products")).rows.length,3);
   await assert.rejects(pg.query("update inventory_products set stock_qty=7"),/permission denied/);
   const snapshot=async()=> (await pg.query<{value:unknown}>("select jsonb_build_object('products',(select jsonb_agg(to_jsonb(p) order by id) from inventory_products p),'movements',(select jsonb_agg(to_jsonb(m) order by id) from inventory_movements m),'reports',(select jsonb_agg(to_jsonb(r) order by id) from inventory_reports r)) value")).rows[0].value;
   const before=await snapshot();
   await pg.exec("reset role");await pg.exec(alignment);await pg.exec("set role service_role");
   assert.deepEqual(await snapshot(),before,"alignment must preserve catalog, balances, reports and the entire movement ledger");
  });
 }finally{await pg.close();}
});
