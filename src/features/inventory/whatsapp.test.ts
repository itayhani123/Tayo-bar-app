import test from "node:test";
import assert from "node:assert/strict";
import type {SupabaseClient} from "@supabase/supabase-js";
import {processInventoryReport} from "./whatsapp";
import {AttendanceInputError} from "@/features/ai-assistant/attendance-input";
test("Structured Outputs inventory extraction resolves existing rows and prepares only; price instructions never reach the model",async()=>{
 const calls:string[]=[];let modelCalls=0;
 const db={rpc:(name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{calls.push(name);if(name==="inventory_catalog")return{data:{products:[{id:"product",name:"גרייגוס",bottle_ml:750,active:true,stock_qty:10,aliases:[]}],events:[{id:"event",venue_name:"אפטאון",client_name:"מעיין",event_date:"2026-11-15"}]},error:null};assert.equal(name,"prepare_inventory_whatsapp");assert.deepEqual(args.p_lines,[{product_id:"product",quantity:4}]);assert.doesNotMatch(String(args.p_summary),/₪|cost|UUID/);return{data:true,error:null};}})} as unknown as SupabaseClient;
 const client={responses:{create:async(options:{text:{format:{type:string;strict:boolean}}})=>{modelCalls++;assert.equal(options.text.format.type,"json_schema");assert.equal(options.text.format.strict,true);return{status:"completed",output_text:JSON.stringify({kind:"consumption",venue:"אפטאון",day:15,month:11,year:null,entries:[{name:"גרייגוס",quantity:4}]})};}}} as unknown as Parameters<typeof processInventoryReport>[3];
 const job={id:"report",actor_id:"actor",lease_token:"lease",message_text:"צריכת אלכוהול\nאפטאון 15/11\n4 גרייגוס"};
 assert.equal(await processInventoryReport(db,job,new AbortController().signal,client),true);assert.deepEqual(calls,["inventory_catalog","prepare_inventory_whatsapp"]);
 assert.equal(await processInventoryReport(db,{...job,message_text:"צריכת אלכוהול\nאפטאון 15.11.2026\n4 גרייגוס"},new AbortController().signal,client),true);
 await assert.rejects(processInventoryReport(db,{...job,message_text:"צריכת אלכוהול\nאפטאון 15.11.2026\n1.5 גרייגוס"},new AbortController().signal,client),AttendanceInputError);
 await assert.rejects(processInventoryReport(db,{...job,message_text:"צריכת אלכוהול שנה מחיר ל־90"},new AbortController().signal,client),AttendanceInputError);assert.equal(modelCalls,2);
});
