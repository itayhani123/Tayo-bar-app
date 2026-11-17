import type {SupabaseClient} from "@supabase/supabase-js";
export async function readInventoryCosts(db:SupabaseClient,eventIds:string[]){
 if(!eventIds.length)return new Map<string,string>();
 const result=await db.rpc("read_inventory_event_costs",{p_events:eventIds});if(result.error)throw new Error("לא ניתן לטעון עלויות אלכוהול מאושרות; בדקו שהמיגרציות הוחלו");
 return new Map<string,string>((result.data as {event_id:string;cost_agorot:string}[]).map(row=>[row.event_id,row.cost_agorot]));
}
export function effectiveAlcoholCost(estimated:number,actualAgorot:string|undefined){return actualAgorot===undefined?estimated:Number(actualAgorot)/100;}
