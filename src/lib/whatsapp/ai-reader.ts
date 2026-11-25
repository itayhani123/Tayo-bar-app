import type {SupabaseClient} from '@supabase/supabase-js';
import {allowedTool,toolSchema} from '@/features/ai-assistant/policy';
import {executeDataTool} from '@/features/ai-assistant/data-tools';
import {z} from 'zod';
export function assertAiToolAccess(role:string,name:string){if(!allowedTool(role,name))throw new Error('FORBIDDEN_TOOL');}
const snapshotSchema=z.object({events:z.array(z.record(z.string(),z.unknown())),event_assignments:z.array(z.record(z.string(),z.unknown())),inventory_movements:z.array(z.record(z.string(),z.unknown())),event_payments:z.array(z.record(z.string(),z.unknown())),venue_settlements:z.array(z.record(z.string(),z.unknown()))}).strict();
// A SELECT-only in-memory view of one server-authorized, bounded snapshot.
// No RPC, insert, update, delete or arbitrary query reaches the model engine.
function snapshotClient(snapshot:z.infer<typeof snapshotSchema>):SupabaseClient{
 return {from(table:string){
  if(!Object.hasOwn(snapshot,table))throw new Error('FORBIDDEN_TOOL');
  let rows=snapshot[table as keyof typeof snapshot];
  const aliases:Record<string,string>={venue_id:'venueId',event_date:'eventDate',event_id:table==='inventory_movements'?'event_id':'eventId'};
  const field=(row:Record<string,unknown>,key:string)=>row[aliases[key]??key];
  const query={select(){return query;},order(){return query;},limit(){return query;},
   eq(key:string,value:unknown){rows=rows.filter(r=>field(r,key)===value);return query;},
   in(key:string,values:unknown[]){rows=rows.filter(r=>values.includes(field(r,key)));return query;},
   gte(key:string,value:string){rows=rows.filter(r=>String(field(r,key))>=value);return query;},
   lte(key:string,value:string){rows=rows.filter(r=>String(field(r,key))<=value);return query;},
   abortSignal(signal:AbortSignal){signal.throwIfAborted();return Promise.resolve({data:rows,error:null,count:rows.length});}};
  return query;
 }} as unknown as SupabaseClient;
}
export function createWhatsAppAiReader(db:SupabaseClient,job:{id:string;lease_token:string},phoneId:string){
 return {async read(role:string,name:string,rawArgs:unknown,signal:AbortSignal){
  assertAiToolAccess(role,name);const args=toolSchema.parse(rawArgs);
  const result=await db.rpc('read_whatsapp_ai_snapshot',{p_id:job.id,p_lease:job.lease_token,p_phone_id:phoneId,p_tool:name,p_args:args}).abortSignal(signal);
  if(result.error)throw new Error('DATA_UNAVAILABLE');
  const snapshot=snapshotSchema.parse(result.data);
  return executeDataTool(snapshotClient(snapshot),role,name,args,signal);
 }};
}
