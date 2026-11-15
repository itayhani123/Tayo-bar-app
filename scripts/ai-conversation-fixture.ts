// Synthetic local PostgreSQL only. Used by offline tests and opt-in live OpenAI conversation checks.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";

export const fixtureIds = { owner: "11111111-1111-4111-8111-111111111111", manager: "22222222-2222-4222-8222-222222222222", venue: "33333333-3333-4333-8333-333333333333", employee: "44444444-4444-4444-8444-444444444444", event: "55555555-5555-4555-8555-555555555555" };
export async function conversationFixture() {
  const pg = new PGlite();
  const ids = fixtureIds;
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.profiles(id uuid primary key,role text not null);
    create table public.venues(id uuid primary key,name text,updated_at timestamptz default now());
    create table public.employees(id uuid primary key,full_name text,active boolean default true,default_hourly_rate numeric default 50);
    create table public.event_types(id uuid primary key default gen_random_uuid(),name text);
    create table public.bar_packages(id uuid primary key default gen_random_uuid(),name text);
    create table public.payment_methods(id uuid primary key default gen_random_uuid(),name text);
    insert into auth.users values('${ids.owner}'),('${ids.manager}');
    insert into public.profiles values('${ids.owner}','owner'),('${ids.manager}','manager');
    insert into public.venues(id,name) values('${ids.venue}','קסנאדו'),('66666666-6666-4666-8666-666666666666','אפטאון');
    insert into public.employees(id,full_name) values('${ids.employee}','יוסי');
    insert into public.event_types(name) values('Wedding'),('Other');
    insert into public.bar_packages(name) values('Premium'),('Pouring');
    insert into public.payment_methods(name) values('Cash'),('Bit');`);
  for (const file of ["002_events.sql", "005_event_staffing.sql", "006_event_finance_and_colors.sql", "007_event_payments_timestamps.sql", "008_events_vat_inclusive.sql", "013_venue_settlements.sql", "014_venue_settlement_allocations.sql"]) await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await pg.exec("alter table public.events add column sales_status text");
  for (const file of ["016_ai_assistant_actions.sql", "017_ai_conversations.sql", "018_ai_conversation_recovery.sql"]) await pg.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await pg.exec(`grant usage on schema public,auth to service_role,authenticated,anon;
    grant all on all tables in schema public to service_role;
    grant usage,select on all sequences in schema public to service_role;
    insert into public.events(id,event_date,start_time,event_type,venue_id,client_name,guest_count,price_per_guest,package_type,payer_type,price_includes_vat)
    values('${ids.event}','2026-11-11','19:00','Wedding','${ids.venue}','דני',200,30,'Premium','venue',true);
    set role service_role;`);
  const identifier = (s: string) => { if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(s)) throw new Error("Invalid fixture SQL identifier"); return `"${s}"`; };
  const rpcNames = new Set(["begin_ai_turn", "finish_ai_turn", "release_ai_turn", "checkpoint_ai_turn", "ai_action_snapshot", "register_ai_action", "decide_ai_action"]);
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: ids.owner } }, error: null }) },
    rpc(name: string, params: Record<string, unknown>) {
      if (!rpcNames.has(name)) throw new Error("Unexpected fixture RPC");
      return { abortSignal: async () => {
        const keys = Object.keys(params);
        const values = Object.values(params).map(v => v !== null && typeof v === "object" ? JSON.stringify(v) : v);
        const result = await pg.query<{ data: unknown }>(`select public.${identifier(name)}(${keys.map((key, i) => `${identifier(key)}=>$${i + 1}`).join(",")}) data`, values);
        return { data: result.rows[0].data, error: null };
      } };
    },
    from(table: string) {
      const values: unknown[] = [], where: string[] = [], order: string[] = [];
      let fields = "*", limit = 1000, single = false;
      const execute = async () => {
        const projection = fields === "*" ? "to_jsonb(t)" : `jsonb_build_object(${fields.split(/,(?![^()]*\))/).flatMap(field => {
          const item = field.trim();
          if (item === "venue:venues(name)") return ["'venue'", "(select jsonb_build_object('name',v.name) from public.venues v where v.id=t.venue_id)"];
          if (item === "employee:employees(full_name)") return ["'employee'", "(select jsonb_build_object('full_name',e.full_name) from public.employees e where e.id=t.employee_id)"];
          const [alias, column] = item.includes(":") ? item.split(":") : [item, item];
          identifier(alias); return [`'${alias}'`, `t.${identifier(column)}`];
        }).join(",")})`;
        const clause = where.length ? `where ${where.join(" and ")}` : "";
        const result = await pg.query<{ data: unknown[]; count: number }>(`select coalesce(jsonb_agg(s.row),'[]'::jsonb) data,(select count(*)::int from public.${identifier(table)} t ${clause}) count from (select ${projection} row from public.${identifier(table)} t ${clause} ${order.length ? `order by ${order.join(",")}` : ""} limit ${limit}) s`, values);
        return { data: single ? result.rows[0].data[0] ?? null : result.rows[0].data, count: result.rows[0].count, error: null };
      };
      const filter = (column: string, op: string, value: unknown) => { values.push(value); where.push(`t.${identifier(column)} ${op} $${values.length}`); return q; };
      const q = {
        select(input: string) { fields = input; return q; }, eq: (c: string, v: unknown) => filter(c, "=", v), gt: (c: string, v: unknown) => filter(c, ">", v), gte: (c: string, v: unknown) => filter(c, ">=", v), lte: (c: string, v: unknown) => filter(c, "<=", v), ilike: (c: string, v: unknown) => filter(c, "ilike", v),
        in(c: string, v: string[]) { values.push(v); where.push(`t.${identifier(c)}::text=any($${values.length}::text[])`); return q; },
        order(c: string) { order.push(`t.${identifier(c)}`); return q; }, limit(n: number) { limit = n; return q; }, abortSignal() { return q; },
        single() { single = true; return execute(); }, maybeSingle() { single = true; return execute(); }, then(resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then(resolve, reject); },
      }; return q;
    },
  } as unknown as SupabaseClient;
  return { pg, db, ids, close: () => pg.close() };
}
