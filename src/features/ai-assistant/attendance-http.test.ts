import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleAttendanceRequest } from "./attendance-http";
import { attendanceExample, extracted } from "./attendance-fixture";
import { confirmAttendance } from "./attendance-service";

test("attendance API authenticates, enforces live role, origin, quota, schema and explicit confirmation", async () => {
  let role = "manager", authenticated = true, quota = true, confirms = 0, extracts = 0, previews = 0;
  const actor = "11111111-1111-4111-8111-111111111111";
  const db = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: actor } : null }, error: null }) },
    from: () => { const q = { select: () => q, eq: () => q, abortSignal: () => q, single: async () => ({ data: { role }, error: null }) }; return q; },
    rpc: () => ({ abortSignal: async () => ({ data: quota, error: null }) }),
  } as unknown as SupabaseClient;
  const deps = {
    createClient: async () => db, admin: () => db, configured: true,
    extract: async () => { extracts++; return extracted; },
    preview: async () => { previews++; return { extracted, events: [], eventId: null, employees: [], rows: [], issues: [] }; },
    confirm: async (_db: SupabaseClient, id: string) => { assert.equal(id, actor); confirms++; return { status: "succeeded" }; },
  };
  const request = (body: unknown, origin = "https://tayo.test") => new Request("https://tayo.test/api/ai-assistant/attendance", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const confirm = { action: "confirm", proposalId: actor, confirmed: true };
  assert.equal((await handleAttendanceRequest(request(confirm, "https://other.test"), deps)).status, 403);
  authenticated = false; assert.equal((await handleAttendanceRequest(request(confirm), deps)).status, 401);
  authenticated = true; role = "employee"; assert.equal((await handleAttendanceRequest(request(confirm), deps)).status, 403);
  role = "manager";
  assert.equal((await handleAttendanceRequest(request({ action: "confirm", proposalId: actor }), deps)).status, 400);
  assert.equal((await handleAttendanceRequest(request({ ...confirm, actorId: actor }), deps)).status, 400);
  assert.equal(confirms, 0);
  assert.equal((await handleAttendanceRequest(request({ action: "extract", text: attendanceExample }), deps)).status, 200);
  assert.equal(extracts, 1); assert.equal(previews, 1); assert.equal(confirms, 0);
  quota = false; assert.equal((await handleAttendanceRequest(request({ action: "extract", text: attendanceExample }), deps)).status, 429);
  assert.equal(extracts, 1);
  // Retry confirmation remains available even when model quota/key is unavailable.
  assert.equal((await handleAttendanceRequest(request(confirm), { ...deps, configured: false })).status, 200);
  assert.equal(confirms, 1);
});
test("standalone confirmation cannot bypass a WhatsApp report's atomic approval and receipt path",async()=>{
  let calls=0;let linked=true;
  const db={from:()=>{const q={select:()=>q,eq:()=>q,limit:()=>q,abortSignal:()=>q,maybeSingle:async()=>linked?{data:{id:"report"},error:null}:{data:null,error:{code:"42P01"}}};return q;},rpc:()=>({abortSignal:async()=>{calls++;return{data:{status:"succeeded"},error:null};}})} as unknown as SupabaseClient;
  assert.equal((await confirmAttendance(db,"actor","proposal",new AbortController().signal)).status,"forbidden");assert.equal(calls,0);
  linked=false;assert.equal((await confirmAttendance(db,"actor","proposal",new AbortController().signal)).status,"succeeded");assert.equal(calls,1);
});
