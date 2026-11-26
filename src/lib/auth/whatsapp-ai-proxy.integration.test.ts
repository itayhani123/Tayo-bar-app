import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {NextRequest as NextRequestType} from 'next/server';
import {aiFixture} from '@/lib/whatsapp/ai-db-fixture';

// Resolve Next's extensionless entry for Node's ESM runner. Replace only the
// route's external DB factory and Meta transport, not the Proxy, auth rules,
// route POST, AI HTTP handler, queue worker or SQL functions being exercised.
type Resolution={url:string;shortCircuit?:boolean};
type Hooks={resolve:(specifier:string,context:{parentURL?:string},next:(specifier:string,context:unknown)=>Resolution)=>Resolution};
const {registerHooks}=createRequire(import.meta.url)('node:module') as {
  registerHooks:(hooks:Hooks)=>{deregister:()=>void};
};

test('actual Proxy -> route POST -> SQL: AI bearer auth works without a session and central-off does no AI work',async t=>{
 const envNames=['WHATSAPP_AI_FALLBACK_ENABLED','WHATSAPP_AI_WORKER_SECRET','WHATSAPP_AI_OPENAI_API_KEY','WHATSAPP_PHONE_NUMBER_ID','CRON_SECRET','OPENAI_API_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
 const saved=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));
 const globals=globalThis as typeof globalThis & {__tayoProxyTest?:{db:()=>SupabaseClient;send:()=>Promise<string>}};
 const oldBindings=globals.__tayoProxyTest,oldFetch=globalThis.fetch;
 const f=await aiFixture(true,false,'production');
 const calls:string[]=[];let opened=0,sends=0,network=0;
 const secret='synthetic-dedicated-worker-secret-'.repeat(2);
 const db={rpc(name:string,args:Record<string,unknown>){calls.push(name);assert.equal(name,'claim_whatsapp_ai');return f.db.rpc(name,args);}} as unknown as SupabaseClient;
 globals.__tayoProxyTest={db:()=>{opened++;return db;},send:async()=>{sends++;throw Error('Unexpected Meta send');}};
 const hook=registerHooks({resolve(specifier,context,next){
  if(specifier==='next/server')return next('next/server.js',context);
  if(context.parentURL?.endsWith('/src/app/api/cron/whatsapp-ai/route.ts')){
   if(specifier==='@/lib/supabase/admin')return{url:'data:text/javascript,'+encodeURIComponent('export function createAdminClient(){return globalThis.__tayoProxyTest.db();}'),shortCircuit:true};
   if(specifier==='@/lib/whatsapp/client')return{url:'data:text/javascript,'+encodeURIComponent('export async function sendAttendanceReceipt(){return globalThis.__tayoProxyTest.send();}'),shortCircuit:true};
  }
  return next(specifier,context);
 }});
 try{
  Object.assign(process.env,{WHATSAPP_AI_FALLBACK_ENABLED:'true',WHATSAPP_AI_WORKER_SECRET:secret,WHATSAPP_AI_OPENAI_API_KEY:'synthetic-ai-project-key',WHATSAPP_PHONE_NUMBER_ID:f.phoneId,CRON_SECRET:'synthetic-reporting-secret',OPENAI_API_KEY:'synthetic-report-project-key',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:9',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'synthetic-local-only-key'});
  // Leave an existing AI task queued, then disable centrally. The request must
  // neither claim/mutate it nor generate/send an answer, despite code flag=true.
  await f.allow(f.phone,f.owner);await f.control(true);assert.equal(await f.receive(),true);await f.control(false);
  const before=(await f.pg.query('select * from whatsapp_ai_tasks order by inbox_id')).rows;
  globalThis.fetch=async()=>{network++;throw Error('External network/model access forbidden');};
  const {NextRequest}=await import('next/server');
  const {proxy,config}=await import('@/proxy');
  const {POST}=await import('@/app/api/cron/whatsapp-ai/route');
  const request=(path='/api/cron/whatsapp-ai',token?:string)=>new NextRequest('https://tayo.test'+path,{method:'POST',headers:token?{authorization:'Bearer '+token}:{}});
  // Framework hand-off: only a genuine Proxy pass-through may reach the actual
  // route handler. A future forgotten exemption therefore fails this test.
  const dispatch=async(req:NextRequestType)=>{
   assert.ok(new RegExp('^'+config.matcher[0]+'$').test(req.nextUrl.pathname));
   const gate=await proxy(req);
   return gate.headers.get('x-middleware-next')==='1'?POST(req):gate;
  };
  await t.test('missing Bearer is JSON 401, never a login redirect',async()=>{
   const r=await dispatch(request());assert.equal(r.status,401);assert.equal(r.headers.get('location'),null);assert.match(r.headers.get('content-type')??'',/application\/json/);assert.deepEqual(await r.json(),{error:'Unauthorized'});assert.equal(opened,0);
  });
  await t.test('wrong Bearer and reporting secret are rejected before DB access',async()=>{
   for(const token of ['wrong-secret','synthetic-reporting-secret']){const r=await dispatch(request(undefined,token));assert.equal(r.status,401);assert.equal(r.headers.get('location'),null);}
   assert.equal(opened,0);assert.deepEqual(calls,[]);
  });
  await t.test('valid Bearer with central-off returns exactly processed zero',async()=>{
   const r=await dispatch(request(undefined,secret));assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);assert.match(r.headers.get('content-type')??'',/application\/json/);assert.deepEqual(await r.json(),{processed:0});
   assert.equal(opened,1);assert.deepEqual(calls,['claim_whatsapp_ai','claim_whatsapp_ai']);
   assert.deepEqual((await f.pg.query('select * from whatsapp_ai_tasks order by inbox_id')).rows,before);
   assert.equal((await f.pg.query<{n:number}>('select count(*)::int n from whatsapp_ai_usage')).rows[0].n,0);
   assert.equal((await f.pg.query<{n:number}>("select count(*)::int n from whatsapp_attendance_receipts where kind='ai_answer'")).rows[0].n,0);
   assert.equal(sends,0);assert.equal(network,0);
  });
  await t.test('similar names, subpaths and cron root still require a session',async()=>{
   for(const path of ['/api/cron','/api/cron/','/api/cron/whatsapp-ai/','/api/cron/whatsapp-ai/debug','/api/cron/whatsapp-ai-unsafe','/api/cron/other-worker']){
    const r=await dispatch(request(path,secret));assert.equal(r.status,307,path);assert.equal(new URL(r.headers.get('location')!).pathname,'/login',path);
   }
   assert.equal(opened,1);
  });
  await t.test('report cron/webhook exemptions and protected business routes stay unchanged',async()=>{
   for(const path of ['/api/cron/whatsapp-notifications','/api/webhooks/whatsapp'])assert.equal((await proxy(request(path))).headers.get('x-middleware-next'),'1');
   for(const path of ['/api/inventory','/api/ai-assistant','/api/ai-assistant/actions'])assert.equal((await proxy(request(path))).status,401,path);
   assert.equal((await proxy(request('/events'))).status,307);assert.equal(opened,1);assert.equal(network,0);assert.equal(sends,0);
  });
 }finally{
  hook.deregister();globalThis.fetch=oldFetch;
  if(oldBindings===undefined)delete globals.__tayoProxyTest;else globals.__tayoProxyTest=oldBindings;
  for(const name of envNames){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];}
  await f.pg.close();
 }
});
