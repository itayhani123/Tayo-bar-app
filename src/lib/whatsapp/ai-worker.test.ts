import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {answerQuestion,type ReadOnlyAnswer} from '@/features/ai-assistant/service';
import {handleMetaWebhook} from './webhook';
import {processWhatsAppAi} from './ai-worker';
import {aiFixture} from './ai-db-fixture';
import {assertAiToolAccess} from './ai-reader';
test('signed webhook routes only standalone clear questions to AI; pending replies, buttons and reports retain precedence',async()=>{
 const old=process.env.WHATSAPP_AI_FALLBACK_ENABLED;process.env.WHATSAPP_AI_FALLBACK_ENABLED='true';
 const calls:string[]=[];const db={rpc:async(name:string)=>{calls.push(name);return{data:true,error:null};}} as unknown as SupabaseClient;
 const secret='test-signature',token=crypto.randomUUID(),id=crypto.randomUUID();
 const messages=[
  {type:'text',text:{body:'מי עובד מחר?'}},
  {type:'text',text:{body:'מי עובד מחר?'},context:{id:'pending-summary'}},
  {type:'text',text:{body:'2'}},
  {type:'interactive',interactive:{type:'button_reply',button_reply:{id:`attendance:choose:${id}:${token}:${crypto.randomUUID()}`}}},
  {type:'interactive',interactive:{type:'button_reply',button_reply:{id:`attendance:confirm:${id}:${token}`}}},
  {type:'interactive',interactive:{type:'button_reply',button_reply:{id:`inventory:confirm:${id}:${token}`}}},
  {type:'text',text:{body:'התקבלו למלאי 2 בקבוקי גרייגוס'}},
  {type:'text',text:{body:'הגעה 12:30 יציאה 16:55'}},
  {type:'text',text:{body:'מלאי 70'}},
 ];
 try{
  const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'business'},messages:messages.map(m=>({...m,id:crypto.randomUUID(),from:'972500000001',timestamp:String(Math.floor(Date.now()/1000))}))}}]}]});
  const request=new Request('https://tayo.test/api/webhooks/whatsapp',{method:'POST',body:raw,headers:{'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(raw).digest('hex')}});
  assert.equal((await handleMetaWebhook(request,()=>db,{secret,phoneId:'business'})).status,200);
  assert.deepEqual(calls,['receive_whatsapp_ai','receive_whatsapp_attendance','receive_whatsapp_event_selection','receive_whatsapp_event_selection','receive_whatsapp_attendance_button','receive_whatsapp_attendance_button','receive_inventory_whatsapp','receive_whatsapp_attendance','receive_whatsapp_attendance']);
 }finally{if(old===undefined)delete process.env.WHATSAPP_AI_FALLBACK_ENABLED;else process.env.WHATSAPP_AI_FALLBACK_ENABLED=old;}
});
test('existing answerQuestion engine has no database/action capability in WhatsApp mode',async()=>{
 let calls=0,reads=0;const toolArgs={start:'2026-01-01',end:'2026-01-02',venueId:null};
 const client={responses:{create:async(options:{tools:{name:string}[]})=>{
  assert.ok(options.tools.every(t=>!t.name.startsWith('propose_')));
  if(calls++===0)return {status:'completed',output_text:'',output:[{type:'function_call',name:'propose_create_event',call_id:'injected',arguments:'{}'}]};
  if(calls===2)return {status:'completed',output_text:'',output:[{type:'function_call',name:'financial_summary',call_id:'money',arguments:JSON.stringify(toolArgs)}]};
  return {status:'completed',output_text:'אין הרשאה לשינוי או למידע כספי.',output:[]};
 }}} as unknown as Parameters<typeof answerQuestion>[4];
 const reader:ReadOnlyAnswer={read:async(role,name)=>{assertAiToolAccess(role,name);reads++;return{};}};
 const answer=await answerQuestion(null,'manager',[{role:'user',content:'מי עובד מחר?'}],new AbortController().signal,client,undefined,undefined,reader);
 assert.match(answer,/אין הרשאה/);assert.equal(reads,0);
 await assert.rejects(answerQuestion({} as SupabaseClient,'owner',[],new AbortController().signal,client,undefined,undefined,reader),/READ_ONLY_CONTEXT_REQUIRED/);
});
test('AI intake failure does not skip reporting messages later in the same envelope',async()=>{
 const old=process.env.WHATSAPP_AI_FALLBACK_ENABLED;process.env.WHATSAPP_AI_FALLBACK_ENABLED='true';
 const calls:string[]=[];const db={rpc:async(name:string)=>{calls.push(name);return{data:true,error:name==='receive_whatsapp_ai'?{code:'PGRST202'}:null};}} as unknown as SupabaseClient;
 const secret='test-signature';
 const messages=['מי עובד מחר?','התקבלו למלאי 2 בקבוקי גרייגוס','הגעה 12:30 יציאה 16:55'].map(text=>({type:'text',text:{body:text},id:crypto.randomUUID(),from:'972500000001',timestamp:String(Math.floor(Date.now()/1000))}));
 const raw=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'business'},messages}}]}]});
 try{
  const req=new Request('https://tayo.test/api/webhooks/whatsapp',{method:'POST',body:raw,headers:{'x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(raw).digest('hex')}});
  assert.equal((await handleMetaWebhook(req,()=>db,{secret,phoneId:'business'})).status,503);
  assert.deepEqual(calls,['receive_whatsapp_ai','receive_inventory_whatsapp','receive_whatsapp_attendance']);
 }finally{if(old===undefined)delete process.env.WHATSAPP_AI_FALLBACK_ENABLED;else process.env.WHATSAPP_AI_FALLBACK_ENABLED=old;}
});
test('AI worker uses bound reader and existing sender; model failure is safe and no business rows change',async()=>{
 const f=await aiFixture();
 try{
  await f.receive();const sends:string[]=[];
  const fake:typeof answerQuestion=async(db,role,messages,signal,client,propose,context,reader)=>{
   assert.equal(db,null);assert.equal(propose,undefined);assert.equal(context,undefined);assert.equal(role,'owner');assert.equal(messages.length,1);
   const data=await reader!.read(role,'operations',{start:'2026-01-01',end:'2026-01-02',venueId:null},signal);
   assert.doesNotMatch(JSON.stringify(data),/PRIVATE_PHONE|INJECTED/);return 'תשובת בדיקה';
  };
  assert.equal(await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async(_phone,text)=>{sends.push(text);return'test-provider';},fake),2);
  assert.match(sends[0],/תשובת בדיקה/);
  assert.equal(await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async()=>{throw Error('must not send');},fake),0);
  await f.receive();
  await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async(_phone,text)=>{assert.doesNotMatch(text,/SECRET/);sends.push(text);return'test-failure-provider';},async()=>{throw Error('SECRET_PROVIDER_ERROR');});
  assert.match(sends[1],/לא ניתן לענות/);
  await f.receive();
  const hanging:typeof answerQuestion=async(_db,_role,_messages,signal)=>new Promise<string>((_resolve,reject)=>{
   if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });
  await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async(_phone,text)=>{sends.push(text);return'test-timeout-provider';},hanging,5);
  assert.match(sends[2],/לא ניתן לענות/);
  assert.equal((await f.pg.query<{n:number}>("select count(*)::int n from whatsapp_ai_tasks where error_code='AI_TIMEOUT'")).rows[0].n,1);
  await f.receive();let attempts=0;
  await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async()=>{attempts++;throw Error('unverified external delivery');},fake);
  assert.equal(await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async()=>{attempts++;return'never';},fake),0);
  assert.equal(attempts,1);
  assert.equal((await f.pg.query<{n:number}>('select count(*)::int n from inventory_movements')).rows[0].n,0);
  assert.equal((await f.pg.query<{n:number}>('select count(*)::int n from ai_action_audit')).rows[0].n,0);
 }finally{await f.pg.close();}
});
test('default engine cannot fall back to the attendance API key, even without a test answer override',async()=>{
 const f=await aiFixture();const app=process.env.OPENAI_API_KEY,ai=process.env.WHATSAPP_AI_OPENAI_API_KEY,fetcher=globalThis.fetch;let requests=0;
 try{
  process.env.OPENAI_API_KEY='synthetic-report-key';delete process.env.WHATSAPP_AI_OPENAI_API_KEY;
  globalThis.fetch=async()=>{requests++;throw Error('No network permitted');};
  await f.receive();await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async()=> 'safe-failure-provider');
  process.env.WHATSAPP_AI_OPENAI_API_KEY='synthetic-report-key';
  await f.receive();await processWhatsAppAi(f.db,new AbortController().signal,f.phoneId,async()=> 'safe-shared-provider');
  assert.equal(requests,0);
 }finally{globalThis.fetch=fetcher;if(app===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=app;if(ai===undefined)delete process.env.WHATSAPP_AI_OPENAI_API_KEY;else process.env.WHATSAPP_AI_OPENAI_API_KEY=ai;await f.pg.close();}
});
