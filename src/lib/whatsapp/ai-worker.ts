import type {SupabaseClient} from '@supabase/supabase-js';
import OpenAI from 'openai';
import {z} from 'zod';
import {answerQuestion} from '@/features/ai-assistant/service';
import {createWhatsAppAiReader} from './ai-reader';
const jobSchema=z.object({id:z.uuid(),lease_token:z.uuid(),role:z.enum(['owner','manager']),text:z.string().max(2000)});
const sendSchema=z.object({id:z.uuid(),lease_token:z.uuid(),role:z.enum(['owner','manager']),phone:z.string().regex(/^[1-9]\d{7,14}$/),answer:z.string().min(1).max(3800),receipt_id:z.uuid()});
export {whatsappAiEnabled} from './ai-routing';
export async function processWhatsAppAi(db:SupabaseClient,signal:AbortSignal,phoneId:string,send:(phone:string,text:string)=>Promise<string>,answer:typeof answerQuestion=answerQuestion,modelTimeoutMs=25000){
 const call=async(name:string,args:Record<string,unknown>,abort:AbortSignal=signal)=>{
  const r=await db.rpc(name,args).abortSignal(abort);if(r.error)throw new Error('AI_QUEUE_UNAVAILABLE');return r.data;
 };
 let completed=0;
 const claimed=await call('claim_whatsapp_ai',{p_phone_id:phoneId,p_send:false});
 if(claimed){
  const job=jobSchema.parse(claimed);const deadline=AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(modelTimeoutMs,25000)))]);
  let body:string,code:string|null=null;
  try{
   const live=await call('whatsapp_ai_identity',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_status:'processing'},deadline);
   if(live!==job.role)throw new Error('AI_MODEL_AUTH_CHANGED');
   const reader=createWhatsAppAiReader(db,job,phoneId);
   // Never consume the attendance/application OpenAI key as a fallback.
   const client=new OpenAI({apiKey:async()=>{
    const key=process.env.WHATSAPP_AI_OPENAI_API_KEY?.trim();if(!key||key===process.env.OPENAI_API_KEY?.trim())throw new Error('AI_PROVIDER_CONFIGURATION_REQUIRED');
    return key;
   },organization:null,project:null,timeout:20000,maxRetries:0});
   const text=await answer(null,job.role,[{role:'user',content:job.text}],deadline,client,undefined,undefined,reader);
   deadline.throwIfAborted();
   body=('TAYO AI — מידע בלבד\n'+text).slice(0,3800);
  }catch{
   code=deadline.aborted?'AI_TIMEOUT':'AI_FAILED';
   body='לא ניתן לענות כרגע דרך TAYO AI. נסו שוב מאוחר יותר. דיווחים ואישורים ממתינים לא שונו.';
   console.warn('WhatsApp AI answer unavailable',{code,taskId:job.id});
  }
  // Use the parent deadline to persist a safe timeout reply. Never reuse model
  // timeout cancellation as a reason to mutate an attendance/inventory report.
  if(await call('complete_whatsapp_ai',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_answer:body,p_code:code}))completed++;
 }
 const outbound=await call('claim_whatsapp_ai',{p_phone_id:phoneId,p_send:true});
 if(outbound){
  const job=sendSchema.parse(outbound);
  try{
   const live=await call('whatsapp_ai_identity',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_status:'sending'});
   if(live!==job.role)throw new Error('AI_SEND_AUTH_CHANGED');
   signal.throwIfAborted();
   const provider=await send(job.phone,job.answer);
   if(await call('ack_whatsapp_ai',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_provider:provider})!==true)throw new Error('AI_DELIVERY_ACK_UNVERIFIED');
   completed++;
  }catch{
   // An external delivery may already have happened. Do not blindly resend.
   await call('fail_whatsapp_ai_delivery',{p_id:job.id,p_lease:job.lease_token});
   console.warn('WhatsApp AI delivery unverified',{taskId:job.id});
  }
 }
 return completed;
}
