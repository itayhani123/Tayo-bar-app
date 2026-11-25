import {createAdminClient} from '@/lib/supabase/admin';
import {whatsappAiEnabled,whatsappAiProviderConfigured} from '@/lib/whatsapp/ai-routing';
import {handleWhatsAppAiWorker} from '@/lib/whatsapp/ai-worker-http';
import {sendAttendanceReceipt} from '@/lib/whatsapp/client';
export const runtime='nodejs';
export const maxDuration=60;
// Separate function/invocation budget. The reporting Cron never awaits a model.
export async function POST(request:Request){
 return handleWhatsAppAiWorker(request,{secret:process.env.WHATSAPP_AI_WORKER_SECRET,reportingSecret:process.env.CRON_SECRET,enabled:whatsappAiEnabled(),providerConfigured:whatsappAiProviderConfigured(),phoneId:process.env.WHATSAPP_PHONE_NUMBER_ID,
  db:createAdminClient,send:(phone,text)=>sendAttendanceReceipt(phone,text,false,undefined,'ai_answer')});
}
