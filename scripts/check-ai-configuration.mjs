// Read-only diagnostics. Prints presence/status only, never credentials or business rows.
// node --env-file=.env.local scripts/check-ai-configuration.mjs --database
import { createClient } from "@supabase/supabase-js";
const names = ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
console.log(JSON.stringify({ environment: Object.fromEntries(names.map(name => [name, Boolean(process.env[name]?.trim())])) }));
console.log(JSON.stringify({ scope: ["production", "preview", "development"].includes(process.env.VERCEL_ENV) ? process.env.VERCEL_ENV : "local", modelOverridePresent: Boolean(process.env.OPENAI_MODEL?.trim()), alternativeOpenAINamesPresent: ["OPENAI_KEY", "OPENAI_TOKEN", "OPEN_AI_API_KEY", "NEXT_PUBLIC_OPENAI_API_KEY"].filter(name => Boolean(process.env[name]?.trim())) }));
if (names.some(name => !process.env[name]?.trim())) process.exitCode = 1;
if (process.argv.includes("--database")) {
  try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.log(JSON.stringify({ database: "not_checked_missing_server_configuration" })); process.exitCode = 1; }
  else {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const tables = { ai_assistant_usage: "bucket,requests,expires_at", ai_action_proposals: "id,actor_id,actor_role,request_key,action,target_id,payload,expected,summary,expires_at,status,result", ai_action_audit: "id,proposal_id,actor_id,action,target_id,outcome,occurred_at", ai_conversations: "id,actor_id,actor_role,state,messages,lease_id,lease_until,active_request,revision,updated_at,expires_at", ai_conversation_turns: "conversation_id,request_id,fingerprint,message,response" };
    for (const [table, fields] of Object.entries(tables)) {
      // limit(0) verifies table/grant availability without retrieving any business/chat rows.
      const result = await db.from(table).select(fields).limit(0).abortSignal(AbortSignal.timeout(8000));
      console.log(JSON.stringify({ table, available: !result.error, code: result.error?.code ?? null }));
      if (result.error) process.exitCode = 1;
    }
    const metadata = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" }, signal: AbortSignal.timeout(8000) });
    if (metadata.ok) {
      const spec = await metadata.json();
      for (const name of ["begin_ai_turn", "finish_ai_turn", "release_ai_turn", "checkpoint_ai_turn"]) {
        const available = Boolean(spec.paths?.[`/rpc/${name}`]);
        console.log(JSON.stringify({ rpcMetadata: name, available }));
        if (!available) process.exitCode = 1;
      }
    } else console.log(JSON.stringify({ rpcMetadata: "not_verified", status: metadata.status }));
  }
  } catch { console.log(JSON.stringify({ database: "not_verified", code: "DATABASE_DIAGNOSTIC_FAILED" })); process.exitCode = 1; }
}
