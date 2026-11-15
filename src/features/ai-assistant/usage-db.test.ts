import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("durable quota migration denies anonymous access and enforces minute, user/day and global/day budgets", async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111";
  const manager = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.profiles(id uuid, role text);
      insert into public.profiles values ('${owner}', 'owner'), ('${manager}', 'manager');
      grant usage on schema public, auth to authenticated, anon;`);
    await db.exec(readFileSync("supabase/migrations/015_ai_assistant_usage.sql", "utf8"));
    await db.exec("set role anon");
    await assert.rejects(db.query("select public.consume_ai_assistant_usage()"), /permission denied/);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select public.consume_ai_assistant_usage()"), /Unauthorized/);
    await db.exec(`select set_config('request.jwt.claim.sub', '${owner}', false)`);
    const consume = async () => (await db.query<{ allowed: boolean }>("select public.consume_ai_assistant_usage() as allowed")).rows[0].allowed;
    for (let i = 0; i < 6; i++) assert.equal(await consume(), true);
    assert.equal(await consume(), false);
    await assert.rejects(db.exec("delete from public.ai_assistant_usage"), /permission denied/);
    await db.exec("reset role; delete from public.ai_assistant_usage where bucket like 'minute:%'; update public.ai_assistant_usage set requests=40 where bucket like 'day:%'; set role authenticated;");
    assert.equal(await consume(), false);
    await db.exec(`select set_config('request.jwt.claim.sub', '${manager}', false)`);
    assert.equal(await consume(), true);
    await db.exec("reset role; update public.ai_assistant_usage set requests=300 where bucket like 'global:%'; set role authenticated;");
    assert.equal(await consume(), false);
  } finally { await db.close(); }
});
