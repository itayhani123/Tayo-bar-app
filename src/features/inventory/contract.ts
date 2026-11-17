import {z} from "zod";

const money=z.string().regex(/^\d+$/);
const line=z.object({product_id:z.string(),quantity:z.number().int()});
export const inventoryOverviewSchema=z.object({
 products:z.array(z.object({id:z.string(),name:z.string(),category:z.string(),bottle_ml:z.number().int(),stock_qty:z.number().int(),minimum_qty:z.number().int(),active:z.boolean(),aliases:z.array(z.string()),cost_agorot:money.optional(),value_agorot:money.optional()})),
 movements:z.array(z.object({id:z.string(),report_id:z.string(),product_id:z.string(),product_name:z.string(),bottle_ml:z.number(),event_id:z.string().nullable(),kind:z.string(),quantity_delta:z.number().int(),unit_cost_agorot:money.optional(),total_cost_agorot:money.optional(),actor_id:z.string(),created_at:z.string(),reason:z.string().nullable(),correction_of:z.string().nullable()})),
 reports:z.array(z.object({id:z.string(),kind:z.string(),event_id:z.string().nullable(),lines:z.array(line),status:z.string(),actor_id:z.string(),inbox_id:z.string().nullable(),reason:z.string().nullable(),confirmed_at:z.string().nullable(),confirmed_by:z.string().nullable(),preview_costs:z.array(z.object({total_cost_agorot:money})).optional()})),
 events:z.array(z.object({id:z.string(),event_date:z.string(),client_name:z.string(),venue_name:z.string().nullable().transform(v=>v??"ללא אולם")})),
 inbox:z.array(z.object({id:z.string(),message_text:z.string(),status:z.string(),error_code:z.string().nullable(),delivery_status:z.string().nullable()})),
 senders:z.array(z.object({phone:z.string(),can_receive:z.boolean()})),
});
export const inventoryCostsSchema=z.array(z.object({event_id:z.string(),cost_agorot:z.string().regex(/^-?\d+$/)}));
export const inventoryCatalogSchema=inventoryOverviewSchema.pick({products:true,events:true});
export const inventoryDataSchema=inventoryOverviewSchema.extend({costs:inventoryCostsSchema,role:z.enum(["owner","manager"]),actor:z.string(),actorLabels:z.record(z.string(),z.string())}).superRefine((data,ctx)=>{
 if(data.role!=="owner"){
  if(data.costs.length||data.products.some(p=>p.cost_agorot!==undefined||p.value_agorot!==undefined)||data.movements.some(m=>m.unit_cost_agorot!==undefined||m.total_cost_agorot!==undefined)||data.reports.some(r=>r.preview_costs!==undefined))ctx.addIssue({code:"custom",message:"Unexpected financial fields"});
  return;
 }
 if(data.products.some(p=>p.cost_agorot===undefined||p.value_agorot===undefined)||data.movements.some(m=>m.unit_cost_agorot===undefined||m.total_cost_agorot===undefined))ctx.addIssue({code:"custom",message:"Missing owner cost fields"});
});
export type InventoryData=z.infer<typeof inventoryDataSchema>;

export async function inventoryRequest(body?:unknown,fetcher:typeof fetch=fetch){
 const response=await fetcher("/api/inventory",{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined,cache:"no-store"});
 if(response.redirected)throw new Error("ההתחברות פגה. התחברו מחדש ונסו שוב.");
 let value:unknown;try{value=await response.json();}catch{throw new Error("השרת החזיר תשובה שאינה תקינה. רעננו את הדף ונסו שוב.");}
 if(!response.ok){const error=z.object({error:z.string().max(500)}).safeParse(value);throw new Error(error.success?error.data.error:"לא ניתן לטעון את המלאי. נסו שוב.");}
 return value;
}
export async function loadInventory(fetcher:typeof fetch=fetch):Promise<InventoryData>{
 const result=inventoryDataSchema.safeParse(await inventoryRequest(undefined,fetcher));
 if(!result.success)throw new Error("נתוני המלאי אינם תואמים לגרסת האפליקציה. יש לבדוק מיגרציות וגרסת שרת.");
 return result.data;
}
