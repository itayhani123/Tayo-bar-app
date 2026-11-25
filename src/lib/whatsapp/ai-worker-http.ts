import type {SupabaseClient} from '@supabase/supabase-js';
import {hasValidCronAuthorization} from './security';
import {processWhatsAppAi} from './ai-worker';
export async function handleWhatsAppAiWorker(request:Request,deps:{secret?:string;reportingSecret?:string;enabled:boolean;providerConfigured?:boolean;phoneId?:string;db:()=>SupabaseClient;send:(phone:string,text:string)=>Promise<string>;run?:typeof processWhatsAppAi}){
 if(!deps.secret||deps.secret.length<32||deps.secret===deps.reportingSecret)return Response.json({error:'AI worker configuration unavailable'},{status:503});
 if(!hasValidCronAuthorization(request.headers.get('authorization'),deps.secret))return Response.json({error:'Unauthorized'},{status:401});
 if(!deps.enabled)return Response.json({processed:0,disabled:true});
 if(!deps.providerConfigured)return Response.json({error:'Dedicated AI provider configuration unavailable'},{status:503});
 if(!deps.phoneId)return Response.json({error:'AI configuration unavailable'},{status:503});
 try{
  const processed=await(deps.run??processWhatsAppAi)(deps.db(),AbortSignal.any([request.signal,AbortSignal.timeout(45000)]),deps.phoneId,deps.send);
  return Response.json({processed});
 }catch{console.warn('WhatsApp AI worker unavailable',{code:'AI_WORKER_UNAVAILABLE'});return Response.json({error:'AI worker unavailable'},{status:503});}
}
