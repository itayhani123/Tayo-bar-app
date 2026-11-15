// Read-only incident trace. Never prints phones, tokens, message bodies, or credentials.
// node --env-file=.env.local scripts/diagnose-whatsapp-attendance.mjs
import {createClient} from "@supabase/supabase-js";
import {createHash} from "node:crypto";
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error("SUPABASE_CONFIGURATION_MISSING");
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const output=value=>console.log(JSON.stringify(value));
const hash=value=>createHash("sha256").update(value||"").digest("hex").slice(0,16);
const local=value=>value?new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Jerusalem",dateStyle:"short",timeStyle:"medium"}).format(new Date(value)):null;
// GET RPC executes read-only; synthetic nonexistent keys cannot match a live job.
const probeUrl=new URL(`${url.replace(/\/$/,"")}/rest/v1/rpc/complete_whatsapp_attendance_analysis`);
for(const[k,v]of Object.entries({p_inbox:"00000000-0000-0000-0000-000000000000",p_lease:"00000000-0000-0000-0000-000000000000",p_extracted:"{}",p_preview:"{}",p_parts:"[]"}))probeUrl.searchParams.set(k,v);
const probeResponse=await fetch(probeUrl,{headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
const probe=await probeResponse.json();
output({schemaPolicyGuardPresent:probe?.code==="22023"&&probe?.message==="WHATSAPP_WORKER_VERSION_MISMATCH",probeCode:probe?.code||null,readOnlyProbe:true});
const catalog=await db.rpc("ai_attendance_catalog",{p_day:15,p_month:11,p_year:2026},{get:true});
if(!catalog.error){const ids=new Set(catalog.data.venues.filter(v=>v.name.trim()==="אפטאון").map(v=>v.id));output({stage:"catalog",exactVenueCount:ids.size,eventCount:catalog.data.events.filter(e=>ids.has(e.venue_id)).length,jonathanExactCount:catalog.data.employees.filter(e=>e.full_name.trim()==="יונתן לולו").length,royExactCount:catalog.data.employees.filter(e=>e.full_name.trim()==="רועי כהן").length});}
const read=async(query)=>{const r=await query.abortSignal(AbortSignal.timeout(15000));if(r.error){output({errorCode:r.error.code||"NETWORK_UNAVAILABLE"});process.exitCode=1;return null;}return r.data;};
output({endpointFingerprint:hash(new URL(url).hostname),mode:"read_only",incidentDate:"2026-11-15"});
const reports=await read(db.from("whatsapp_attendance_inbox").select("*").gte("message_at","2026-11-15T00:00:00Z").lt("message_at","2026-11-16T00:00:00Z").order("received_at").limit(200));
if(reports){
 output({reportsFound:reports.length,truncated:reports.length===200});
 const ids=reports.map(r=>r.id);
 const decisions=ids.length?await read(db.from("whatsapp_attendance_decisions").select("*").in("inbox_id",ids).order("received_at").limit(500)):[];
 const receipts=ids.length?await read(db.from("whatsapp_attendance_receipts").select("*").in("inbox_id",ids).order("created_at").limit(500)):[];
 const proposals=ids.length?await read(db.from("ai_attendance_imports").select("id,status,created_at,expires_at,fingerprint").in("id",[...new Set(reports.flatMap(r=>[r.proposal_id,r.confirmation_proposal]).filter(Boolean))])):[];
 for(const r of reports){
  output({stage:"source_clocks",reportId:r.id,messageAt:r.message_at,clocks:r.message_text.match(/\b\d{1,2}:\d{1,2}\b/g)||[]});
  const p=proposals?.find(p=>p.id===r.proposal_id);
  output({stage:"inbox",id:r.id,messageId:r.provider_message_id,messageAt:r.message_at,messageAtJerusalem:local(r.message_at),receivedAt:r.received_at,status:r.status,attempts:r.attempts,errorCode:r.error_code,availableAt:r.available_at,leaseUntil:r.lease_until,textFingerprint:hash(r.message_text),containsRange1230to1735:/12:30\s*[-–]\s*17:35/.test(r.message_text),containsTruncatedClock:/17:3(?!\d)/.test(r.message_text),employeeLines:r.message_text.split("\n").filter(line=>/\d{1,2}:\d/.test(line)).length,policy:r.preview?.confirmationPolicy||null,previewIssues:r.preview?.issues?.length??null,rowIssues:r.preview?.rows?.map(row=>row.issues?.length??null),proposalId:r.proposal_id,confirmationProposalMatches:r.proposal_id===r.confirmation_proposal,confirmationExpiresAt:r.confirmation_expires_at,proposalCreatedAt:p?.created_at,proposalExpiresAt:p?.expires_at,proposalStatus:p?.status});
 }
 for(const d of decisions||[]){const r=reports.find(r=>r.id===d.inbox_id);const matching=receipts?.find(receipt=>receipt.inbox_id===d.inbox_id&&receipt.message_payload?.buttons?.some(button=>button.id===`attendance:${d.decision}:${d.inbox_id}:${d.token}`));output({stage:"decision",id:d.id,messageId:d.provider_message_id,reportId:d.inbox_id,decision:d.decision,messageAt:d.message_at,messageAtJerusalem:local(d.message_at),receivedAt:d.received_at,status:d.status,attempts:d.attempts,resultStatus:d.result?.status,tokenMatchesCurrent:d.token===r?.confirmation_token,tokenMatchesOriginalOutbound:Boolean(matching),matchedOutboundId:matching?.id,originalOutboundSentAt:matching?.sent_at,secondsFromReport:(Date.parse(d.message_at)-Date.parse(r?.message_at))/1000,secondsUntilExpiry:(Date.parse(r?.confirmation_expires_at)-Date.parse(d.message_at))/1000,sourceType:d.source_type||"not_recorded"});}
 for(const r of receipts||[])output({stage:"outbox",id:r.id,reportId:r.inbox_id,kind:r.kind,status:r.status,attempts:r.attempts,errorCode:r.error_code,createdAt:r.created_at,sentAt:r.sent_at,availableAt:r.available_at,leaseUntil:r.lease_until,messageId:r.provider_message_id,partIndex:r.part_index,parts:r.message_payload?.parts?.length,policy:r.message_payload?.policy,bodyFingerprint:hash(r.body),isExpiredFeedback:r.body?.includes("תוקף האישור פג")||false});
}
