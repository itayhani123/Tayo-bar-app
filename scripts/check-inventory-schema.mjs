// Read-only: zero-row schema queries and OpenAPI metadata. Never invokes a write RPC.
// node --env-file=.env.local scripts/check-inventory-schema.mjs
import {createClient} from "@supabase/supabase-js";
import {createHash} from "node:crypto";

const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const safeCode=value=>typeof value==="string"&&/^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(value)?value:null;
if(!url||!key){console.log(JSON.stringify({code:"INVENTORY_DIAGNOSTIC_CONFIGURATION_MISSING"}));process.exitCode=1;}
else try{
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 console.log(JSON.stringify({endpointFingerprint:createHash("sha256").update(new URL(url).hostname).digest("hex").slice(0,16)}));
 const tables={inventory_products:"id,name,bottle_ml,cost_agorot,stock_qty,aliases",inventory_reports:"id,kind,event_id,lines,preview_costs,event_snapshot,status,inbox_id",inventory_movements:"id,report_id,event_id,quantity_delta,unit_cost_agorot,total_cost_agorot",inventory_sender_permissions:"phone,user_id,can_receive",whatsapp_attendance_inbox:"id,report_type,status,error_code,lease_token",whatsapp_attendance_receipts:"id,kind,message_payload,created_at",whatsapp_attendance_decisions:"id,source_type,reply_context_message_id"};
 for(const[table,fields]of Object.entries(tables)){
  const result=await db.from(table).select(fields).limit(0).abortSignal(AbortSignal.timeout(8000));
  console.log(JSON.stringify({table,available:!result.error,code:safeCode(result.error?.code)}));
  if(result.error&&!safeCode(result.error.code))throw new Error("NETWORK_OR_CONFIGURATION_UNAVAILABLE");
  if(result.error)process.exitCode=1;
  if(["42703","PGRST204"].includes(result.error?.code))for(const column of fields.split(",")){
   const checked=await db.from(table).select(column).limit(0).abortSignal(AbortSignal.timeout(8000));
   if(checked.error)console.log(JSON.stringify({table,missingColumn:column,code:safeCode(checked.error.code)}));
  }
 }
 const response=await fetch(`${url.replace(/\/$/,"")}/rest/v1/`,{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:"application/openapi+json"},signal:AbortSignal.timeout(10000)});
 if(!response.ok){console.log(JSON.stringify({metadataAvailable:false,status:response.status}));process.exitCode=1;}
 else{
  const spec=await response.json();
  for(const table of Object.keys(tables))console.log(JSON.stringify({table,schemaFields:Object.keys(spec.definitions?.[table]?.properties??{})}));
  for(const rpc of["inventory_overview","inventory_event_costs","inventory_save_product","inventory_prepare","inventory_confirm","inventory_cancel","inventory_catalog","receive_inventory_whatsapp","prepare_inventory_whatsapp","execute_inventory_decision","claim_whatsapp_attendance","execute_whatsapp_attendance_decision","request_whatsapp_attendance_correction"]){
   const available=Boolean(spec.paths?.[`/rpc/${rpc}`]?.post);
   const body=spec.paths?.[`/rpc/${rpc}`]?.post?.parameters?.find(parameter=>parameter.in==="body")?.schema;
   console.log(JSON.stringify({rpc,available,arguments:Object.keys(body?.properties??{})}));if(!available)process.exitCode=1;
  }
  const profile=await db.from("profiles").select("id").eq("role","owner").limit(1).maybeSingle().abortSignal(AbortSignal.timeout(8000));
  if(profile.data){
   // This read RPC uses FOR SHARE for role authorization, so PostgREST's GET
   // transaction rejects it (25006). POST permits those locks; it saves no data.
   // Print field names only, never values.
   const overview=await db.rpc("inventory_overview",{p_actor:profile.data.id}).abortSignal(AbortSignal.timeout(8000));
   console.log(JSON.stringify({overviewReadable:!overview.error,code:safeCode(overview.error?.code),overviewFields:overview.data&&typeof overview.data==="object"?Object.keys(overview.data):null}));
  }
 }
}catch{console.log(JSON.stringify({code:"INVENTORY_DIAGNOSTIC_UNAVAILABLE"}));process.exitCode=1;}
