import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { previewAttendance } from "./attendance-service";
import { attendanceTimes } from "./attendance";
import { employees, extracted } from "./attendance-fixture";

const owner = "11111111-1111-4111-8111-111111111111", manager = "22222222-2222-4222-8222-222222222222";
const event = "33333333-3333-4333-8333-333333333333", venue = "44444444-4444-4444-8444-444444444444";
test("attendance real PostgreSQL: preview, atomic commit, updates, replay, authorization, audit and rollback", async t => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create table profiles(id uuid primary key,role text);
      create table venues(id uuid primary key,name text);
      create table employees(id uuid primary key,full_name text,active boolean default true,default_hourly_rate numeric default 60);
      create table ai_action_audit(id bigint generated always as identity,actor_id uuid,action text,target_id uuid,outcome text);
      insert into auth.users values('${owner}'),('${manager}'); insert into profiles values('${owner}','owner'),('${manager}','manager');
      insert into venues values('${venue}','קסנאדו');`);
    await pg.exec(readFileSync("supabase/migrations/002_events.sql", "utf8"));
    await pg.exec(readFileSync("supabase/migrations/005_event_staffing.sql", "utf8"));
    await pg.exec(readFileSync("supabase/migrations/019_ai_attendance_import.sql", "utf8"));
    for (const employee of employees) await pg.query("insert into employees(id,full_name) values($1,$2)", [employee.id, employee.full_name]);
    await pg.query("insert into events(id,event_date,start_time,event_type,venue_id,client_name,guest_count,price_per_guest,package_type,payer_type) values($1,'2026-11-12','19:00','Wedding',$2,'לקוח',100,20,'Basic','client')", [event, venue]);
    await pg.exec("grant usage on schema public,auth to service_role; grant all on all tables in schema public to service_role; grant usage,select on all sequences in schema public to service_role; set role service_role");
    const db = { rpc(name: string, params: Record<string, unknown>) { return { abortSignal: async () => {
      assert.ok(["ai_attendance_catalog", "ai_attendance_snapshot", "register_ai_attendance"].includes(name));
      const args = Object.values(params).map(v => typeof v === "object" && v !== null && !Array.isArray(v) ? JSON.stringify(v) : Array.isArray(v) && name === "register_ai_attendance" ? JSON.stringify(v) : v);
      const result = await pg.query<{ value: unknown }>(`select public.${name}(${Object.keys(params).map((key, i) => `${key}=>$${i + 1}`).join(",")}) value`, args);
      return { data: result.rows[0].value, error: null };
    } }; } } as unknown as SupabaseClient;
    const signal = new AbortController().signal;
    const preview = (allowNew = true, actor = manager) => previewAttendance(db, actor, actor === manager ? "manager" : "owner", extracted, undefined, allowNew, signal);
    const confirm = async (id: string, actor = manager) => (await pg.query<{ value: { status: string; replayed?: boolean } }>("select confirm_ai_attendance($1,$2) value", [actor, id])).rows[0].value;
    const count = async (table: string) => Number((await pg.query<{ n: number }>(`select count(*) n from ${table}`)).rows[0].n);
    await t.test("preview cannot write hours; unassigned employees require separate approval", async () => {
      const p = await preview(false); assert.equal(p.rows.length, 8); assert.equal(p.proposalId, undefined);
      assert.ok(p.issues.some(i => i.includes("אישור נפרד"))); assert.equal(await count("event_assignments"), 0);
    });
    let proposalId: string;
    await t.test("manager saves eight real assignments only after confirmation, payroll defaults retained, audit written", async () => {
      const p = await preview(); assert.equal(p.eventId, event); assert.ok(p.proposalId); proposalId = p.proposalId!;
      assert.equal(await count("event_assignments"), 0);
      assert.equal((await confirm(proposalId, owner)).status, "forbidden");
      assert.equal((await confirm(proposalId)).status, "succeeded");
      assert.equal(await count("event_assignments"), 8); assert.equal(await count("ai_attendance_audit"), 8);
      const result = await pg.query<{ minutes: number; salary: number }>("select extract(epoch from work_end-work_start)/60 minutes, extract(epoch from work_end-work_start)/3600*hourly_rate salary from event_assignments order by employee_id");
      assert.deepEqual(result.rows.map(r => Number(r.minutes)), [595,430,410,410,410,410,410,355]);
      assert.deepEqual(result.rows.map(r => Number(r.salary)), [595,430,410,410,410,410,410,355]);
      assert.doesNotMatch(JSON.stringify(p), /hourly_rate|default_hourly_rate|fixed_pay/);
    });
    await t.test("double click and resubmitted list reuse result without duplicate assignment or audit", async () => {
      assert.equal((await confirm(proposalId)).replayed, true);
      const p = await preview(); assert.equal(p.proposalId, proposalId);
      assert.equal((await confirm(p.proposalId!)).replayed, true);
      assert.equal(await count("event_assignments"), 8); assert.equal(await count("ai_attendance_audit"), 8);
    });
    await t.test("update existing hours without new assignments, preserving fixed pay and existing notes", async () => {
      await pg.query("update event_assignments set pay_type='fixed',hourly_rate=null,fixed_pay=500,notes='קיים' where employee_id=$1", [employees[0].id]);
      const changed = { ...extracted, entries: extracted.entries.map((r, i) => i === 0 ? { ...r, time: "16:00" } : r) };
      const p = await previewAttendance(db, manager, "manager", changed, undefined, false, signal);
      assert.ok(p.proposalId); assert.ok(p.rows.every(r => r.operation === "update"));
      assert.equal((await confirm(p.proposalId!)).status, "succeeded"); assert.equal(await count("event_assignments"), 8);
      const a = (await pg.query<{ fixed_pay: string; notes: string }>("select fixed_pay,notes from event_assignments where employee_id=$1", [employees[0].id])).rows[0];
      assert.equal(Number(a.fixed_pay), 500); assert.equal(a.notes, "קיים; פתיחה");
    });
    await t.test("stale snapshot never overwrites hours and live role revocation blocks confirmation", async () => {
      const changed = { ...extracted, entries: extracted.entries.map((r, i) => i === 0 ? { ...r, time: "16:05" } : r) };
      const p = await previewAttendance(db, manager, "manager", changed, undefined, false, signal);
      await pg.query("update event_assignments set notes='תיקון ידני' where employee_id=$1", [employees[0].id]);
      assert.equal((await confirm(p.proposalId!)).status, "stale");
      const p2 = await previewAttendance(db, manager, "manager", changed, undefined, false, signal);
      await pg.query("update profiles set role='employee' where id=$1", [manager]);
      assert.equal((await confirm(p2.proposalId!)).status, "forbidden");
      await pg.query("update profiles set role='manager' where id=$1", [manager]);
    });
    await t.test("failure in the last row rolls back every prior update and audit record", async () => {
      const p = await previewAttendance(db, owner, "owner", { ...extracted, entries: extracted.entries.map((r, i) => i === 0 ? { ...r, time: "16:01" } : r) }, undefined, false, signal);
      const before = await pg.query("select * from event_assignments order by id");
      const audit = await count("ai_attendance_audit");
      await pg.query("update ai_attendance_imports set payload=jsonb_set(payload,'{7,work_end}','\"2026-11-12T00:00:00Z\"') where id=$1", [p.proposalId]);
      await assert.rejects(confirm(p.proposalId!, owner), /Invalid times/);
      assert.deepEqual((await pg.query("select * from event_assignments order by id")).rows, before.rows);
      assert.equal(await count("ai_attendance_audit"), audit);
    });
    await t.test("overlap, missing fields and duplicate employees never produce executable proposal", async () => {
      const times = attendanceTimes("2026-11-12", "19:00", "02:00");
      const other = "55555555-5555-4555-8555-555555555555";
      await pg.query("insert into events select $1,event_date,start_time,event_type,venue_id,client_name,client_phone,guest_count,price_per_guest,package_type,payer_type,payment_status,manager_employee_id,security_check_received,invoice_issued,estimated_alcohol_cost,notes,created_at,updated_at from events where id=$2", [other, event]);
      await pg.query("insert into event_assignments(event_id,employee_id,role,hourly_rate,work_start,work_end) values($1,$2,'bartender',60,$3,$4)", [other, employees[0].id, times.work_start, times.work_end]);
      const p = await previewAttendance(db, manager, "manager", extracted, { eventId: event, rows: [] }, false, signal);
      assert.equal(p.proposalId, undefined); assert.ok(p.rows[0].issues.some(i => i.includes("התנגשות")));
    });
    await t.test("browser roles cannot execute private mutation RPCs or read stored previews", async () => {
      await pg.exec("reset role; set role authenticated");
      await assert.rejects(pg.query("select confirm_ai_attendance($1,$2)", [manager, proposalId]), /permission denied/);
      await assert.rejects(pg.query("select * from ai_attendance_imports"), /permission denied/);
    });
  } finally { await pg.close(); }
});
