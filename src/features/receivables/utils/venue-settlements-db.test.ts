import { hydrateSettlementHistory } from "./settlement-history";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { calculateReceivableEvent, type RawReceivableEvent } from "./receivables-calculations";
import { calculateVenueClosing, type VenueSettlement } from "./venue-settlements";

const owner = "11111111-1111-4111-8111-111111111111";
const manager = "22222222-2222-4222-8222-222222222222";
const venue = "33333333-3333-4333-8333-333333333333";
type Snapshot = { events: RawReceivableEvent[]; settlements: VenueSettlement[] };

test("PostgreSQL migration: atomic ledger, permissions, retries, stale snapshots and unchanged source rows", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.profiles(id uuid primary key, role text not null);
      create table public.venues(id uuid primary key, name text);
      create table public.employees(id uuid primary key);
      create table public.event_types(id uuid primary key, name text);
    `);
    await db.exec(readFileSync("supabase/migrations/002_events.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/006_event_finance_and_colors.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/013_venue_settlements.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/014_venue_settlement_allocations.sql", "utf8"));
    await db.exec(`
      grant usage on schema public, auth to authenticated, service_role, anon;
      grant select on public.profiles to authenticated;
      grant all on all tables in schema public to service_role;
      insert into auth.users values ('${owner}'), ('${manager}');
      insert into public.profiles values ('${owner}', 'owner'), ('${manager}', 'manager');
      insert into public.venues values ('${venue}', 'אפטאון');
      insert into public.events(id, event_date, start_time, event_type, venue_id, client_name,
        guest_count, price_per_guest, package_type, payer_type, price_includes_vat) values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2020-01-01', '19:00', 'Wedding', '${venue}', 'Customer', 300, 30, 'Premium', 'venue', true),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2020-01-01', '19:00', 'Wedding', '${venue}', 'Customer', 300, 30, 'Premium', 'client', true),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2020-01-02', '19:00', 'Other', '${venue}', 'Later', 100, 30, 'Pouring', 'venue', true);
      insert into public.event_payments(event_id, amount, payment_method, payer_type) values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1000, 'Cash', 'venue');
    `);
    const snapshot = async () => (await db.query<{ value: Snapshot }>("select public.venue_settlement_snapshot($1) as value", [venue])).rows[0].value;
    const close = (source: Snapshot, requestId: string, cutoff = "2020-01-01", actor = owner) => {
      const amount = calculateVenueClosing(source.events.map(calculateReceivableEvent), source.settlements, venue, cutoff).amount;
      return db.query<{ id: string }>("select public.close_venue_settlement($1,$2,$3,$4,$5,$6::jsonb) as id", [venue, cutoff, amount, actor, requestId, JSON.stringify(source)]);
    };
    const before = await snapshot();
    const originalRows = await db.query("select to_jsonb(e) as row from public.events e order by id");
    const originalPayments = await db.query("select to_jsonb(p) as row from public.event_payments p order by id");
    await t.test("non-owner cannot create, including through the trusted RPC", async () => {
      await assert.rejects(close(before, randomUUID(), "2020-01-01", manager), /Owner required/);
    });
    let firstId: string;
    const requestId = randomUUID();
    await t.test("two queued confirmation calls with the same key return one closing", async () => {
      await db.exec("set role service_role");
      const [a, b] = await Promise.all([close(before, requestId), close(before, requestId)]);
      firstId = a.rows[0].id;
      assert.equal(firstId, b.rows[0].id);
      const after = await snapshot();
      assert.equal(after.settlements.length, 1);
      assert.equal(after.settlements[0].amount, 3800);
      assert.equal(calculateVenueClosing(after.events.map(calculateReceivableEvent), after.settlements, venue, "2020-01-01").amount, 0);
      await db.exec("reset role");
    });
    await t.test("different keys with the same stale calculation cannot close twice", async () => {
      await assert.rejects(close(before, randomUUID()), /preview again/);
    });
    await t.test("later events remain open; sequential closing clears only the new cumulative difference", async () => {
      const next = await snapshot();
      assert.equal(calculateVenueClosing(next.events.map(calculateReceivableEvent), next.settlements, venue, "2020-01-02").amount, 3000);
      const results = await Promise.allSettled([close(next, randomUUID(), "2020-01-02"), close(next, randomUUID(), "2020-01-02")]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(results.filter((result) => result.status === "rejected").length, 1);
      await assert.rejects(close(await snapshot(), randomUUID()), /Retroactive cutoff/);
    });
    await t.test("financial source rows and payments are byte-for-byte unchanged", async () => {
      assert.deepEqual(await db.query("select to_jsonb(e) as row from public.events e order by id"), originalRows);
      assert.deepEqual(await db.query("select to_jsonb(p) as row from public.event_payments p order by id"), originalPayments);
    });
    await t.test("source changes invalidate an in-flight calculation", async () => {
      const stale = await snapshot();
      await db.exec("update public.events set guest_count=301 where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
      await assert.rejects(close(stale, randomUUID(), "2020-01-02"), /preview again/);
    });
    await t.test("future cutoff and zero closing are rejected in the database", async () => {
      await assert.rejects(close(await snapshot(), randomUUID(), "9999-01-01"), /Invalid cutoff/);
      const current = await snapshot();
      await assert.rejects(db.query("select public.close_venue_settlement($1,'2020-01-02',0,$2,$3,$4::jsonb)", [venue, owner, randomUUID(), JSON.stringify(current)]), /Invalid settlement amount/);
    });
    await t.test("idempotency keys cannot be reused for a different cutoff", async () => {
      await assert.rejects(close(await snapshot(), requestId, "2020-01-02"), /Request ID already used/);
    });
    await t.test("RLS permits owner reads only; direct ledger writes and RPC calls are denied to authenticated users", async () => {
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${manager}'`);
      assert.equal((await db.query("select * from public.venue_settlements")).rows.length, 0);
      await db.exec(`set request.jwt.claim.sub = '${owner}'`);
      assert.equal((await db.query("select * from public.venue_settlements")).rows.length, 2);
      await assert.rejects(db.query("delete from public.venue_settlements"), /permission denied/);
      await assert.rejects(db.query("update public.venue_settlements set amount=1"), /permission denied/);
      await assert.rejects(db.query("insert into public.venue_settlements(venue_id,cutoff_date,amount,created_by,request_id,source_snapshot) values ($1,'2020-01-02',1,$2,$3,'{}')", [venue, owner, randomUUID()]), /permission denied/);
      await assert.rejects(close(before, randomUUID()), /permission denied/);
      await assert.rejects(snapshot(), /permission denied/);
      await db.exec("reset role; set role anon");
      await assert.rejects(db.query("select * from public.venue_settlements"), /permission denied/);
      await db.exec("reset role");
    });
    await t.test("negative hall-fee-only balance is recorded as a negative closing", async () => {
      const negativeVenue = "44444444-4444-4444-8444-444444444444";
      await db.exec(`insert into public.venues values ('${negativeVenue}', 'קסנאדו');
        insert into public.events(event_date,start_time,event_type,venue_id,client_name,guest_count,price_per_guest,package_type,payer_type)
        values ('2020-01-01','19:00','Wedding','${negativeVenue}','Client',100,30,'Premium','client')`);
      const source = (await db.query<{ value: Snapshot }>("select public.venue_settlement_snapshot($1) as value", [negativeVenue])).rows[0].value;
      const amount = calculateVenueClosing(source.events.map(calculateReceivableEvent), [], negativeVenue, "2020-01-01").amount;
      assert.equal(amount, -300);
      await db.query("select public.close_venue_settlement($1,'2020-01-01',$2,$3,$4,$5::jsonb)", [negativeVenue, amount, owner, randomUUID(), JSON.stringify(source)]);
      assert.equal((await db.query<{ amount: string }>("select amount from public.venue_settlements where venue_id=$1", [negativeVenue])).rows[0].amount, "-300.00");
    });
    await t.test("fee choice and allocations persist; mismatched retries and invalid components are rejected", async () => {
      const source = await snapshot();
      const calculation = calculateVenueClosing(source.events.map(calculateReceivableEvent), hydrateSettlementHistory(source.settlements), venue, "2020-01-02", false);
      const key = randomUUID();
      const args = [venue, calculation.amount, owner, key, JSON.stringify(source), JSON.stringify(calculation.allocations)];
      await assert.rejects(db.query("select public.close_venue_settlement($1,'2020-01-02',$2,$3,$4,$5::jsonb,false,'[]'::jsonb)", args.slice(0,5)), /Invalid allocations/);
      await db.query("select public.close_venue_settlement($1,'2020-01-02',$2,$3,$4,$5::jsonb,false,$6::jsonb)", args);
      const saved = (await db.query<{ includes_hall_fee: boolean; allocations: unknown }>("select includes_hall_fee, allocations from public.venue_settlements where request_id=$1", [key])).rows[0];
      assert.equal(saved.includes_hall_fee, false);
      assert.deepEqual(saved.allocations, calculation.allocations);
      await assert.rejects(db.query("select public.close_venue_settlement($1,'2020-01-02',$2,$3,$4,$5::jsonb,true,$6::jsonb)", args), /Request ID already used/);
      const after = await snapshot();
      const feeClosing = calculateVenueClosing(after.events.map(calculateReceivableEvent), hydrateSettlementHistory(after.settlements), venue, "2020-01-02");
      assert.equal(feeClosing.amount, -7);
    });
  } finally { await db.close(); }
});
