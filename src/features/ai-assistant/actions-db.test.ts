import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { proposeAction } from "./action-proposals";
import type { ActionResult } from "./action-types";

const owner = "11111111-1111-4111-8111-111111111111";
const manager = "22222222-2222-4222-8222-222222222222";
const venue = "33333333-3333-4333-8333-333333333333";
const employee = "44444444-4444-4444-8444-444444444444";
const secondVenue = "66666666-6666-4666-8666-666666666666";
const event = "55555555-5555-4555-8555-555555555555";
const signal = new AbortController().signal;
export const eventChanges = { eventDate: null, startTime: null, venueId: null, clientName: null, guestCount: null, eventType: null, packageType: null, notes: null, pricePerGuest: null, vatRate: null, priceIncludesVat: null, payerType: null, estimatedAlcoholCost: null };
export const assignmentChanges = { eventRole: null, workStart: null, workEnd: null, notes: null, payType: null, hourlyRate: null, fixedPay: null };

test("PostgreSQL confirmed AI actions: real proposals, transactions, audit, permissions and replay protection", async t => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.profiles(id uuid primary key,role text not null);
      create table public.venues(id uuid primary key,name text,updated_at timestamptz default now());
      create table public.employees(id uuid primary key,full_name text,active boolean default true,default_hourly_rate numeric default 50);
      create table public.event_types(id uuid primary key default gen_random_uuid(),name text);
      create table public.bar_packages(id uuid primary key default gen_random_uuid(),name text);
      create table public.payment_methods(id uuid primary key default gen_random_uuid(),name text);
      insert into auth.users values('${owner}'),('${manager}');
      insert into public.profiles values('${owner}','owner'),('${manager}','manager');
      insert into public.venues(id,name) values('${venue}','אפטאון'),('${secondVenue}','קסנאדו');
      insert into public.employees(id,full_name) values('${employee}','דנה');
      insert into public.event_types(name) values('Wedding');
      insert into public.bar_packages(name) values('Premium'),('Pouring');
      insert into public.payment_methods(name) values('Cash');`);
    for (const migration of ["002_events.sql", "005_event_staffing.sql", "006_event_finance_and_colors.sql", "007_event_payments_timestamps.sql", "008_events_vat_inclusive.sql", "013_venue_settlements.sql", "014_venue_settlement_allocations.sql"]) await pg.exec(readFileSync(`supabase/migrations/${migration}`, "utf8"));
    await pg.exec("alter table public.events add column sales_status text");
    await pg.exec(readFileSync("supabase/migrations/016_ai_assistant_actions.sql", "utf8"));
    await pg.exec(`grant usage on schema public,auth to authenticated,anon,service_role;
      grant select on public.profiles to authenticated;
      grant all on all tables in schema public to service_role;
      revoke update,delete,truncate,references,trigger on public.ai_action_audit from service_role;
      insert into public.events(id,event_date,start_time,event_type,venue_id,client_name,guest_count,price_per_guest,package_type,payer_type,price_includes_vat)
        values('${event}','2020-01-01','19:00','Wedding','${venue}','לקוח',300,30,'Premium','venue',true);
      set role service_role;`);
    // Supabase adapter backed by real PostgreSQL. Only the named RPCs and scoped target reads exist.
    const db = {
      rpc(name: string, params: Record<string, unknown>) {
        assert.ok(["ai_action_snapshot", "register_ai_action"].includes(name));
        return { abortSignal: async () => {
          const keys = Object.keys(params);
          const args = Object.values(params).map(v => typeof v === "object" && v !== null ? JSON.stringify(v) : v);
          try { const result = await pg.query<{ value: unknown }>(`select public.${name}(${keys.map((key, i) => `${key}=>$${i + 1}`).join(",")}) as value`, args); return { data: result.rows[0].value, error: null }; }
          catch (error) { throw new Error(`${name}: ${(error as Error).message}`); }
        } };
      },
      from(table: string) {
        assert.ok(["event_assignments", "event_payments"].includes(table));
        let id = "";
        const q = { select: () => q, eq: (_: string, value: string) => { id = value; return q; }, abortSignal: () => q, single: async () => ({ data: (await pg.query(`select event_id${table === "event_assignments" ? ",employee_id" : ""} from public.${table} where id=$1`, [id])).rows[0], error: null }) }; return q;
      },
    } as unknown as SupabaseClient;
    const propose = (name: string, input: unknown, actor = owner, requestId = randomUUID()) => proposeAction(db, actor, actor === owner ? "owner" : "manager", requestId, name, input, signal);
    const decide = async (id: string, decision = "confirm", actor = owner) => (await pg.query<{ result: ActionResult }>("select public.decide_ai_action($1,$2,$3) as result", [actor, id, decision])).rows[0].result;
    const count = async (table: string) => Number((await pg.query<{ n: number }>(`select count(*) n from public.${table}`)).rows[0].n);

    await t.test("preparation and cancellation never mutate business data", async () => {
      const card = await propose("propose_update_event", { ...eventChanges, eventId: event, guestCount: 350 });
      assert.ok(card.rows.some(r => r.label === "מספר אורחים" && r.before === "300" && r.after === "350"));
      assert.equal((await pg.query<{ n: number }>("select guest_count n from public.events where id=$1", [event])).rows[0].n, 300);
      assert.equal((await decide(card.id, "cancel")).status, "cancelled");
      assert.equal((await decide(card.id)).status, "cancelled");
      assert.equal((await pg.query<{ n: number }>("select guest_count n from public.events where id=$1", [event])).rows[0].n, 300);
    });
    let newEventId: string;
    await t.test("create event validates catalogs and replays the same request without duplicate creation", async () => {
      const input = { ...eventChanges, eventDate: "2020-01-02", startTime: "20:00", venueId: venue, clientName: "אירוע חדש", guestCount: 100, eventType: "Wedding", packageType: "Premium", pricePerGuest: 30, vatRate: 18, priceIncludesVat: true, payerType: "client" };
      const requestId = randomUUID();
      const card = await propose("propose_create_event", input, owner, requestId);
      const same = await propose("propose_create_event", input, owner, requestId);
      assert.equal(card.id, same.id);
      const [a, b] = await Promise.all([decide(card.id), decide(card.id)]);
      assert.equal(a.status, "succeeded"); assert.equal(b.status, "succeeded"); assert.equal(b.replayed, true);
      newEventId = a.eventId!;
      assert.equal(await count("events"), 2);
    });
    await t.test("event date, venue, package and financial updates use validated existing fields", async () => {
      const card = await propose("propose_update_event", { ...eventChanges, eventId: newEventId!, eventDate: "2020-02-01", venueId: secondVenue, packageType: "Pouring", pricePerGuest: 35 });
      assert.ok(card.rows.some(r => r.label === "אולם" && r.before === "אפטאון" && r.after === "קסנאדו"));
      assert.equal((await decide(card.id)).status, "succeeded");
      const row = (await pg.query<{ event_date: string; venue_id: string; package_type: string }>("select event_date::text,venue_id,package_type from public.events where id=$1", [newEventId!])).rows[0];
      assert.equal(row.venue_id, secondVenue); assert.equal(row.package_type, "Pouring"); assert.equal(row.event_date, "2020-02-01");
    });
    await t.test("manager operational changes preserve financial fields and omit financial card values", async () => {
      const card = await propose("propose_update_event", { ...eventChanges, eventId: event, guestCount: 320 }, manager);
      assert.doesNotMatch(JSON.stringify(card.rows), /מחיר|שכר|הכנסה|₪/);
      assert.equal((await decide(card.id, "confirm", manager)).status, "succeeded");
      assert.equal((await pg.query<{ price: number }>("select price_per_guest price from public.events where id=$1", [event])).rows[0].price, "30.00");
      await assert.rejects(propose("propose_update_event", { ...eventChanges, eventId: event, pricePerGuest: 99 }, manager), /מנהלים/);
    });
    await t.test("manager creation hides financial defaults while the server applies only existing authorized defaults", async () => {
      const card = await propose("propose_create_event", { ...eventChanges, eventDate: "2027-01-01", startTime: "19:00", venueId: venue, clientName: "אירוע תפעולי", guestCount: 120, eventType: "Wedding", packageType: "Premium" }, manager);
      assert.doesNotMatch(JSON.stringify(card.rows), /מחיר|מע״מ|משלם|עלות אלכוהול|הכנסה|₪/);
      assert.equal((await decide(card.id, "confirm", manager)).status, "succeeded");
    });
    await t.test("stale proposals fail without overwriting concurrent updates", async () => {
      const card = await propose("propose_update_event", { ...eventChanges, eventId: event, guestCount: 400 });
      await pg.query("update public.events set guest_count=321 where id=$1", [event]);
      assert.equal((await decide(card.id)).status, "stale");
      assert.equal((await pg.query<{ n: number }>("select guest_count n from public.events where id=$1", [event])).rows[0].n, 321);
    });
    await t.test("database validation rejects tampered stored payloads and rolls back all business changes", async () => {
      const card = await propose("propose_update_event", { ...eventChanges, eventId: event, guestCount: 500 });
      await pg.query("update public.ai_action_proposals set payload=payload||'{\"guest_count\":0}'::jsonb where id=$1", [card.id]);
      assert.equal((await decide(card.id)).status, "failed");
      assert.equal((await pg.query<{ n: number }>("select guest_count n from public.events where id=$1", [event])).rows[0].n, 321);
      assert.equal((await decide(card.id)).status, "failed");
    });
    let assignmentId: string;
    await t.test("employee assignment uses defaults, blocks duplicates and updates work times", async () => {
      const card = await propose("propose_assign_employee", { ...assignmentChanges, eventId: event, employeeId: employee }, manager);
      const result = await decide(card.id, "confirm", manager);
      assert.equal(result.status, "succeeded"); assignmentId = result.targetId!;
      await assert.rejects(propose("propose_assign_employee", { ...assignmentChanges, eventId: event, employeeId: employee }, manager), /כבר משובץ/);
      const update = await propose("propose_update_assignment", { ...assignmentChanges, assignmentId, workStart: "19:00", workEnd: "03:00" }, manager);
      assert.equal((await decide(update.id, "confirm", manager)).status, "succeeded");
      const row = (await pg.query<{ work_start: Date; work_end: Date }>("select work_start,work_end from public.event_assignments where id=$1", [assignmentId])).rows[0];
      assert.equal((new Date(row.work_end).getTime() - new Date(row.work_start).getTime()) / 3600000, 8);
    });
    let paymentId: string;
    await t.test("payments are atomic and competing confirmations cannot double-record", async () => {
      const input = { eventId: event, amount: 1000, paymentMethod: "Cash", payerType: "venue", paidAt: "2020-01-01", notes: "אסמכתה מקורית" };
      const a = await propose("propose_record_payment", input);
      const b = await propose("propose_record_payment", input);
      const results = await Promise.all([decide(a.id), decide(a.id), decide(b.id)]);
      assert.deepEqual(results.map(r => r.status), ["succeeded", "succeeded", "stale"]);
      assert.equal(await count("event_payments"), 1);
      paymentId = results[0].targetId!;
      const { eventId: _eventId, ...paymentValues } = input;
      void _eventId;
      const correction = await propose("propose_update_payment", { ...paymentValues, paymentId, amount: 1200, notes: null });
      assert.equal((await decide(correction.id)).status, "succeeded");
      assert.equal(await count("event_payments"), 1);
      assert.equal((await pg.query<{ notes: string }>("select notes from public.event_payments where id=$1", [paymentId])).rows[0].notes, "אסמכתה מקורית");
    });
    await t.test("venue closing reuses existing atomic workflow and preserves customer debt", async () => {
      for (const includesHallFee of [false, true]) {
        const card = await propose("propose_close_venue", { venueId: venue, cutoffDate: "2020-01-01", includesHallFee });
        const result = await decide(card.id);
        assert.equal(result.status, "succeeded");
        assert.equal((await decide(card.id)).targetId, result.targetId);
      }
      assert.equal(await count("venue_settlements"), 2);
      assert.equal(await count("event_payments"), 1);
    });
    await t.test("actor binding, expiry and role revocation block confirmation", async () => {
      const card = await propose("propose_update_event", { ...eventChanges, eventId: event, guestCount: 400 });
      assert.equal((await decide(card.id, "confirm", manager)).status, "forbidden");
      await pg.query("update public.ai_action_proposals set expires_at=now()-interval '1 second' where id=$1", [card.id]);
      assert.equal((await decide(card.id)).status, "expired");
      const revoked = await propose("propose_record_payment", { eventId: event, amount: 200, paymentMethod: "Cash", payerType: "venue", paidAt: "2020-01-01", notes: "" });
      await pg.query("update public.profiles set role='manager' where id=$1", [owner]);
      assert.equal((await decide(revoked.id)).status, "forbidden");
      await pg.query("update public.profiles set role='owner' where id=$1", [owner]);
    });
    await t.test("remove assignment retains employee and payment records, and every outcome has an audit row", async () => {
      const card = await propose("propose_remove_assignment", { assignmentId: assignmentId! });
      assert.equal((await decide(card.id)).status, "succeeded");
      assert.equal(await count("event_assignments"), 0); assert.equal(await count("employees"), 1); assert.equal(await count("event_payments"), 1);
      const outcomes = (await pg.query<{ outcome: string }>("select distinct outcome from public.ai_action_audit")).rows.map(r => r.outcome);
      for (const outcome of ["proposed", "cancelled", "succeeded", "stale", "expired", "forbidden", "failed"]) assert.ok(outcomes.includes(outcome));
    });
    await t.test("browser roles cannot forge proposals, execute RPCs or read private snapshots", async () => {
      await assert.rejects(pg.query("delete from public.ai_action_audit"), /permission denied/);
      await pg.exec("reset role; set role authenticated");
      await assert.rejects(pg.query("select public.decide_ai_action($1,$2,'confirm')", [owner, randomUUID()]), /permission denied/);
      await assert.rejects(pg.query("select * from public.ai_action_proposals"), /permission denied/);
      await assert.rejects(pg.query("select public.ai_action_snapshot('propose_update_event',$1,'{}')", [event]), /permission denied/);
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [manager]);
      assert.equal(await count("ai_action_audit"), 0);
      await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
      assert.ok(await count("ai_action_audit") > 0);
    });
  } finally { await pg.close(); }
});
