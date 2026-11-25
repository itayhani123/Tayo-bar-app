import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import type {SupabaseClient} from '@supabase/supabase-js';
export async function aiFixture(install=true,enable=true,source:'020'|'production'='020'){
 const pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,banned_until timestamptz,deleted_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table profiles(id uuid primary key,role text not null);create table venues(id uuid primary key,name text not null);create table event_types(id uuid primary key,name text);
 create table employees(id uuid primary key,full_name text not null,active boolean not null,default_hourly_rate numeric(10,2) not null);
 create table business_settings(key text primary key,numeric_value numeric);create table ai_action_audit(actor_id uuid,action text,target_id uuid,outcome text);
 create table app_notifications(role_target text,notification_type text,title text,message text,severity text,entity_type text,entity_id uuid,action_url text,dedupe_key text);
 create unique index on app_notifications(dedupe_key) where dedupe_key is not null;`);
 for(const file of ['002_events','005_event_staffing','006_event_finance_and_colors','008_events_vat_inclusive','013_venue_settlements','014_venue_settlement_allocations','019_ai_attendance_import','020_whatsapp_attendance_inbox','021_whatsapp_sender_configuration_repair','022_whatsapp_attendance_bot','023_whatsapp_receipt_created_at','024_whatsapp_attendance_confirmation_ux','025_whatsapp_attendance_buttons_only','026_whatsapp_attendance_reliability','027_inventory','028_inventory_whatsapp','030_inventory_schema_alignment','033_whatsapp_attendance_event_selection'])await pg.exec(readFileSync(`supabase/migrations/${file}.sql`,'utf8'));
 if(source==='production')await pg.exec(readFileSync('src/lib/whatsapp/fixtures/receive-attendance-production.sql','utf8'));
 const migration=readFileSync('supabase/migrations/034_whatsapp_ai_readonly.sql','utf8');
 if(install)await pg.exec(migration);
 const owner=crypto.randomUUID(),manager=crypto.randomUUID(),venue=crypto.randomUUID(),event=crypto.randomUUID(),employee=crypto.randomUUID();
 const phone='972500000001',managerPhone='972500000002',phoneId='test-business';
 await pg.query('insert into auth.users(id) values($1),($2)',[owner,manager]);await pg.query("insert into profiles values($1,'owner'),($2,'manager')",[owner,manager]);
 await pg.query("insert into venues values($1,'אולם בדיקה')",[venue]);await pg.query("insert into employees values($1,'עובד בדיקה',true,60)",[employee]);
 await pg.query("insert into events(id,event_date,start_time,event_type,venue_id,client_name,client_phone,guest_count,price_per_guest,package_type,payer_type,notes) values($1,'2026-01-01','14:00','Brit',$2,'לקוח בדיקה','PRIVATE_PHONE',100,200,'Basic','client','INJECTED SECRET NOTES')",[event,venue]);
 await pg.query("insert into event_assignments(event_id,employee_id,role,event_role,pay_type,hourly_rate,fixed_pay) values($1,$2,'bartender','bartender','fixed',null,100)",[event,employee]);
 const rpc=async(name:string,args:Record<string,unknown>={})=>{
  if(!/^[a-z_]+$/.test(name)||Object.keys(args).some(k=>!/^p_[a-z_]+$/.test(k)))throw Error('BAD_TEST_RPC');
  const keys=Object.keys(args);return (await pg.query<{v:unknown}>(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,keys.map(k=>args[k]!==null&&typeof args[k]==='object'&&!['p_employees','p_ids'].includes(k)?JSON.stringify(args[k]):args[k]))).rows[0].v;
 };
 await rpc('configure_whatsapp_attendance_sender',{p_actor:owner,p_phone:phone,p_user:owner,p_enabled:true,p_auto:false});
 await rpc('configure_whatsapp_attendance_sender',{p_actor:owner,p_phone:managerPhone,p_user:manager,p_enabled:true,p_auto:false});
 const asOwner=async(name:string,args:Record<string,unknown>)=>{
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  try{return await rpc(name,args);}finally{await pg.exec("select set_config('request.jwt.claim.sub','',false)");}
 };
 const control=(enabled:boolean)=>asOwner('set_whatsapp_ai_control',{p_enabled:enabled,p_phone_id:phoneId});
 const allow=(from:string,user:string,enabled=true)=>asOwner('set_whatsapp_ai_sender',{p_phone:from,p_user:user,p_enabled:enabled});
 if(install&&enable){await allow(phone,owner);await allow(managerPhone,manager);await control(true);}
 const db={rpc(name:string,args:Record<string,unknown>){const promise=rpc(name,args).then(data=>({data,error:null})).catch((error:Error)=>({data:null,error:{code:'TEST',message:error.message}}));return Object.assign(promise,{abortSignal:()=>promise});}} as unknown as SupabaseClient;
 const receive=(text='מי עובד מחר?',from=phone,message=crypto.randomUUID())=>rpc('receive_whatsapp_ai',{p_message_id:message,p_phone:from,p_phone_id:phoneId,p_text:text,p_at:new Date().toISOString()});
 const claim=(send=false)=>rpc('claim_whatsapp_ai',{p_phone_id:phoneId,p_send:send}) as Promise<{id:string;lease_token:string;role:string}|null>;
 return{pg,rpc,db,owner,manager,venue,event,employee,phone,managerPhone,phoneId,receive,claim,migration,control,allow};
}
