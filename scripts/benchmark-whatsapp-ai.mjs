// Local disposable PostgreSQL, separate AI process, deterministic report parsing.
// This measures real queue/preview/decision RPC latency, NOT network/OpenAI/Vercel SLA.
import {fork} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {setTimeout as sleep} from 'node:timers/promises';
import {once} from 'node:events';
import {writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {aiFixture} from '../src/lib/whatsapp/ai-db-fixture.ts';
import {previewWhatsAppAttendance} from '../src/features/ai-assistant/attendance-service.ts';
process.on('uncaughtException',error=>{console.error(JSON.stringify({error:error.message,code:error.code}));process.exit(1);});
const scenarios=['off','slow','failed'];const results=[];
for(const mode of scenarios){
 const f=await aiFixture();const latency={attendance:[],inventory:[],approval:[]};let modelStarts=0,childError=false,modelActive=false,overlappingReports=0;
 let child;
 try{
  await f.control(mode!=='off');
  const product=await f.rpc('inventory_save_product',{p_actor:f.owner,p_id:null,p_values:{name:'Benchmark bottle',category:'Test',bottle_ml:1000,cost_agorot:'1000',minimum_qty:0,active:true,aliases:[]}});
  await f.rpc('inventory_set_receipt_permission',{p_actor:f.owner,p_phone:f.phone,p_enabled:true});
  if(mode!=='off'){
   for(let i=0;i<20;i++)await f.receive();
   child=fork('scripts/whatsapp-ai-load-child.mjs',[],{execArgv:['--import','./scripts/test-register.mjs'],stdio:['ignore','ignore','ignore','ipc']});
   child.on('message',message=>{
    if(message.type==='model-started'){modelStarts++;modelActive=true;}
    if(message.type==='model-finished')modelActive=false;
    if(message.type==='child-error')childError=true;
    if(message.type==='rpc')void f.rpc(message.name,message.args).then(data=>{if(child.connected)child.send({type:'result',id:message.id,data});}).catch(()=>{if(child.connected)child.send({type:'result',id:message.id,error:'LOCAL_RPC_FAILED'});});
   });
   child.send({type:'start',mode,phoneId:f.phoneId});
   const deadline=Date.now()+15000;while(!modelStarts&&Date.now()<deadline)await sleep(10);assert.ok(modelStarts>0,'AI must actually overlap reporting');
  }
  async function deliver(inbox){
   const receipt=await f.rpc('claim_whatsapp_attendance',{p_receipt:true});assert.ok(receipt);assert.equal(receipt.inbox_id,inbox);
   assert.equal(await f.rpc('ack_whatsapp_attendance_receipt',{p_receipt:receipt.id,p_lease:receipt.lease_token,p_provider:crypto.randomUUID(),p_final:true,p_next_index:1}),true);
   return receipt;
  }
  async function approve(inbox){
   const token=(await f.pg.query('select confirmation_token from whatsapp_attendance_inbox where id=$1',[inbox])).rows[0].confirmation_token;
   await f.rpc('receive_whatsapp_attendance_button',{p_message_id:crypto.randomUUID(),p_phone:f.phone,p_phone_id:f.phoneId,p_inbox:inbox,p_token:token,p_decision:'confirm',p_at:new Date().toISOString(),p_reply_to:null});
   const decision=await f.rpc('claim_whatsapp_attendance_decision');assert.ok(decision);
   const r=await f.rpc('execute_whatsapp_attendance_decision',{p_id:decision.id,p_lease:decision.lease_token});assert.equal(r.status,'succeeded');
   await deliver(inbox);
  }
  for(let i=0;i<70;i++){
   if(i>=10&&modelActive)overlappingReports+=3;
   const started=performance.now();
   await f.rpc('receive_whatsapp_attendance',{p_message_id:crypto.randomUUID(),p_phone:f.phone,p_phone_id:f.phoneId,p_text:'Synthetic attendance',p_at:new Date().toISOString()});
   const a=await f.rpc('claim_whatsapp_attendance',{p_receipt:false});assert.ok(a);
   const extracted={venue:'אולם בדיקה',day:1,month:1,year:2026,weekday:null,entries:[{name:'עובד בדיקה',direction:'in',time:'12:35',note:null},{name:'עובד בדיקה',direction:'out',time:'16:55',note:null}]};
   const preview=await previewWhatsAppAttendance(f.db,f.owner,'owner',extracted,undefined,new AbortController().signal,undefined,a.id);
   assert.ok(preview.proposalId);assert.equal(preview.issues.length,0);
   await f.rpc('complete_whatsapp_attendance_analysis',{p_inbox:a.id,p_lease:a.lease_token,p_extracted:extracted,p_preview:preview,p_parts:['Synthetic summary']});
   await deliver(a.id);if(i>=10)latency.attendance.push(performance.now()-started);
   const approval=performance.now();await approve(a.id);if(i>=10)latency.approval.push(performance.now()-approval);
   const stock=performance.now();
   await f.rpc('receive_inventory_whatsapp',{p_message_id:crypto.randomUUID(),p_phone:f.phone,p_phone_id:f.phoneId,p_text:'Synthetic receipt',p_at:new Date().toISOString()});
   const q=await f.rpc('claim_whatsapp_attendance',{p_receipt:false});assert.ok(q);
   await f.rpc('prepare_inventory_whatsapp',{p_actor:f.owner,p_inbox:q.id,p_lease:q.lease_token,p_kind:'receipt',p_event:null,p_lines:[{product_id:product,quantity:1}],p_summary:'Synthetic receipt'});
   await deliver(q.id);await approve(q.id);if(i>=10)latency.inventory.push(performance.now()-stock);
   // Reset ONLY synthetic fixture input state/rate-window outside measured spans.
   await f.pg.exec("update event_assignments set work_start=null,work_end=null;update whatsapp_attendance_inbox set received_at=now()-interval '2 hours' where report_type<>'ai_question';update whatsapp_attendance_decisions set received_at=now()-interval '2 hours';update ai_attendance_imports set created_at=now()-interval '2 hours'");
  }
  if(child){const end=once(child,'exit');child.send({type:'stop'});await end;assert.equal(childError,false);}
  const stats=Object.fromEntries(Object.entries(latency).map(([key,values])=>{const sorted=values.sort((a,b)=>a-b);return[key,{samples:sorted.length,p50_ms:+sorted[Math.floor(sorted.length*.5)].toFixed(2),p95_ms:+sorted[Math.floor(sorted.length*.95)].toFixed(2),max_ms:+sorted.at(-1).toFixed(2)}];}));
  if(mode!=='off')assert.ok(overlappingReports>=150,'Most reports must actually overlap the model stall');
  results.push({mode,modelStarts,overlappingReports,stats});
 }finally{if(child?.connected)child.kill();await f.pg.close();}
}
const report={environment:'LOCAL PGlite + separate OS AI process; no network/Production',warmup_per_type:10,samples_per_type:60,synthetic_model_delay_ms:5000,results};
for(const r of results.slice(1))for(const type of Object.keys(r.stats))assert.ok(r.stats[type].p95_ms<=results[0].stats[type].p95_ms+20,'Local p95 regression exceeds 20ms: '+r.mode+'/'+type);
mkdirSync('test-results',{recursive:true});writeFileSync('test-results/ai-load-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
