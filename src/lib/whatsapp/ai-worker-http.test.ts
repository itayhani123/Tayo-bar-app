import test from 'node:test';
import assert from 'node:assert/strict';
import {handleWhatsAppAiWorker} from './ai-worker-http';
test('isolated AI endpoint has its own strong secret, cannot be invoked with report Cron secret and fails closed',async()=>{
 const secret='ai-only-secret-'.repeat(4);let access=0;
 const deps={secret,reportingSecret:'report-only',enabled:true,phoneId:'business',db:()=>{access++;throw Error('Must not touch DB');},send:async()=> 'never'};
 const req=(token?:string)=>new Request('https://tayo.test/api/cron/whatsapp-ai',{method:'POST',headers:token?{authorization:'Bearer '+token}:{}});
 assert.equal((await handleWhatsAppAiWorker(req(),deps)).status,401);
 assert.equal((await handleWhatsAppAiWorker(req('report-only'),deps)).status,401);
 assert.equal((await handleWhatsAppAiWorker(req(secret),{...deps,secret:undefined})).status,503);
 assert.equal((await handleWhatsAppAiWorker(req(secret),{...deps,reportingSecret:secret})).status,503);
 assert.equal((await handleWhatsAppAiWorker(req(secret),deps)).status,503); // No fallback to the report provider key.
 assert.deepEqual(await(await handleWhatsAppAiWorker(req(secret),{...deps,enabled:false})).json(),{processed:0,disabled:true});
 assert.equal(access,0);
});
