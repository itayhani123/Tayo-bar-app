// Read-only schema diagnostics. Zero-row queries, no phone numbers, user IDs, credentials or raw errors.
// node --env-file=.env.local scripts/check-whatsapp-attendance-schema.mjs
import { createClient } from "@supabase/supabase-js";
const names=["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY"];
console.log(JSON.stringify({environment:Object.fromEntries(names.map(name=>[name,Boolean(process.env[name]?.trim())]))}));
if(names.some(name=>!process.env[name]?.trim())){process.exitCode=1;}
else try {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL.trim(),key=process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const tables={whatsapp_attendance_senders:"phone,user_id,enabled,auto_save,updated_by,updated_at",whatsapp_attendance_inbox:"id,actor_id,phone,phone_number_id,message_text,message_at,status,proposal_id",whatsapp_attendance_receipts:"id,inbox_id,phone,status",whatsapp_attendance_audit:"id,actor_id,inbox_id,action,occurred_at",ai_attendance_imports:"id,actor_id,status",profiles:"id,role"};
 for(const[table,fields]of Object.entries(tables)){
  const result=await db.from(table).select(fields).limit(0).abortSignal(AbortSignal.timeout(8000));
  console.log(JSON.stringify({table,available:!result.error,code:result.error?.code||null}));if(result.error)process.exitCode=1;
 }
 const auth=await db.auth.admin.listUsers({page:1,perPage:1});
 console.log(JSON.stringify({adminAuthentication:!auth.error,status:auth.error?.status??200}));if(auth.error)process.exitCode=1;
 if(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY){
  const anonymous=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const result=await anonymous.from("whatsapp_attendance_senders").select("phone").limit(0).abortSignal(AbortSignal.timeout(8000));
  const blocked=result.error?.code==="42501";
  console.log(JSON.stringify({anonymousSenderReadBlocked:blocked,code:result.error?.code||null}));if(!blocked)process.exitCode=1;
 }
 const response=await fetch(`${url.replace(/\/$/,"")}/rest/v1/`,{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:"application/openapi+json"},signal:AbortSignal.timeout(10000)});
 if(!response.ok){console.log(JSON.stringify({metadataAvailable:false,status:response.status}));process.exitCode=1;}
 else{
  const spec=await response.json();
  for(const name of["configure_whatsapp_attendance_sender","receive_whatsapp_attendance","review_whatsapp_attendance","approve_whatsapp_attendance","confirm_ai_attendance","checkpoint_ai_turn"]){
   const operation=spec.paths?.[`/rpc/${name}`]?.post;
   const parameter=operation?.parameters?.find(p=>p.in==="body")?.schema;
   console.log(JSON.stringify({rpc:name,available:Boolean(operation),arguments:parameter?.properties?Object.keys(parameter.properties):null}));if(!operation)process.exitCode=1;
   if(name==="configure_whatsapp_attendance_sender"&&!operation){
    // GET executes in a read-only transaction; invalid synthetic IDs/phone add a second safeguard.
    const probe=new URL(`${url.replace(/\/$/,"")}/rest/v1/rpc/configure_whatsapp_attendance_sender`);
    for(const[k,v]of Object.entries({p_actor:"00000000-0000-0000-0000-000000000000",p_phone:"invalid",p_user:"00000000-0000-0000-0000-000000000000",p_enabled:"false",p_auto:"false"}))probe.searchParams.set(k,v);
    const checked=await fetch(probe,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(8000)});
    const detail=await checked.json().catch(()=>null);
    console.log(JSON.stringify({rpc:name,readOnlyProbe:true,status:checked.status,code:typeof detail?.code==="string"&&/^[A-Z0-9]{5,12}$/.test(detail.code)?detail.code:null}));
   }
  }
 }
}catch{console.log(JSON.stringify({check:"failed",code:"SCHEMA_DIAGNOSTIC_UNAVAILABLE"}));process.exitCode=1;}
