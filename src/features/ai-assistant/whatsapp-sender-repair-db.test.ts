import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";

const owner="11111111-1111-4111-8111-111111111111",manager="22222222-2222-4222-8222-222222222222";
test("021 repairs old WhatsApp sender RPCs idempotently with real grants, RLS, atomic audit and no data loss",async()=>{
 const pg=new PGlite();
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create schema auth;create table auth.users(id uuid primary key);
   create table public.profiles(id uuid primary key,role text);
   create table public.events(id uuid primary key);create table public.ai_attendance_imports(id uuid primary key);
   insert into auth.users values('${owner}'),('${manager}');
   insert into profiles values('${owner}','owner'),('${manager}','manager');`);
  await pg.exec(readFileSync("supabase/migrations/020_whatsapp_attendance_inbox.sql","utf8"));
  // Reproduce the remotely observed older 020 contract in an isolated database.
  await pg.exec("drop function configure_whatsapp_attendance_sender(uuid,text,uuid,boolean,boolean);drop function review_whatsapp_attendance(uuid,uuid,text)");
  await pg.query("insert into whatsapp_attendance_senders(phone,user_id,updated_by) values('972501234567',$1,$2)",[manager,owner]);
  const before=(await pg.query("select * from whatsapp_attendance_senders")).rows;
  const migration=readFileSync("supabase/migrations/021_whatsapp_sender_configuration_repair.sql","utf8");
  await pg.exec(migration);await pg.exec(migration);
  assert.deepEqual((await pg.query("select * from whatsapp_attendance_senders")).rows,before);
  await pg.exec("set role service_role");
  const save=(actor=owner,user=manager,phone="972501234567",enabled=true)=>pg.query("select configure_whatsapp_attendance_sender($1,$2,$3,$4,false)",[actor,phone,user,enabled]);
  await save();await save(owner,manager,"972501234567",false);
  assert.equal((await pg.query<{n:number}>("select count(*)::int n from whatsapp_attendance_senders")).rows[0].n,1);
  assert.equal((await pg.query<{enabled:boolean}>("select enabled from whatsapp_attendance_senders")).rows[0].enabled,false);
  await assert.rejects(save(manager),/Owner permission required/);
  await assert.rejects(save(owner,"33333333-3333-4333-8333-333333333333"),/existing owner or manager/);
  await assert.rejects(save(owner,manager,"invalid"),/Invalid sender configuration/);
  await pg.exec("reset role");
  assert.equal((await pg.query<{n:number}>("select count(*)::int n from whatsapp_attendance_audit")).rows[0].n,2);
  await pg.exec("revoke insert on whatsapp_attendance_audit from service_role;set role service_role");
  await assert.rejects(save(owner,manager,"972509876543"),/permission denied/);
  await pg.exec("reset role");
  assert.equal((await pg.query<{n:number}>("select count(*)::int n from whatsapp_attendance_senders")).rows[0].n,1);
  await pg.exec(migration);
  await pg.exec("set role authenticated");
  await assert.rejects(save(),/permission denied/);
  await assert.rejects(pg.query("select * from whatsapp_attendance_senders"),/permission denied/);
  await pg.exec("reset role;set role anon");await assert.rejects(save(),/permission denied/);
 }finally{await pg.close();}
});
