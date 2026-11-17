import {z} from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";
const line=z.object({product_id:z.uuid(),quantity:z.number().int().min(-100000).max(100000).refine(n=>n!==0)}).strict();
const product=z.object({name:z.string().trim().min(1).max(120),category:z.string().trim().min(1).max(80),bottle_ml:z.number().int().min(1).max(30000),cost_agorot:z.string().regex(/^\d{1,10}$/).refine(n=>BigInt(n)<=BigInt(1000000000)),minimum_qty:z.number().int().min(0).max(1000000),active:z.boolean(),aliases:z.array(z.string().trim().min(1).max(150)).max(30)}).strict();
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("product"),id:z.uuid().nullable(),values:product}).strict(),
 z.object({action:z.literal("prepare"),kind:z.enum(["consumption","receipt","adjustment"]),eventId:z.uuid().nullable(),lines:z.array(line).min(1).max(100),key:z.uuid(),reason:z.string().max(300).nullable()}).strict(),
 z.object({action:z.enum(["confirm","cancel"]),id:z.uuid(),confirmed:z.literal(true)}).strict(),
 z.object({action:z.literal("reverse"),movementId:z.uuid(),key:z.uuid(),reason:z.string().trim().min(2).max(300),confirmed:z.literal(true)}).strict(),
 z.object({action:z.literal("permission"),phone:z.string().regex(/^[1-9]\d{7,14}$/),enabled:z.boolean()}).strict(),
]);
export const inventoryErrors:Record<string,string>={INVENTORY_FORBIDDEN:"אין הרשאה לפעולה זו",INVENTORY_STOCK_INSUFFICIENT:"אין מספיק מלאי. לא נשמר שום חלק מהדיווח",INVENTORY_PRODUCT_NOT_FOUND:"המוצר אינו קיים או אינו פעיל",INVENTORY_EVENT_NOT_FOUND:"האירוע לא נמצא",INVENTORY_RECEIPT_PERMISSION:"אין לשולח הרשאה לקליטת מלאי",INVENTORY_KEY_CONFLICT:"מזהה הפעולה כבר שימש לדיווח אחר",INVENTORY_REASON_REQUIRED:"יש להזין סיבה לתיקון",INVENTORY_INVALID_QUANTITY:"יש להזין כמויות שלמות בלבד",INVENTORY_DUPLICATE_PRODUCT:"יש לבחור כל מוצר פעם אחת בלבד"};
export async function handleInventory(request:Request,deps:{client:()=>Promise<SupabaseClient>;admin:()=>SupabaseClient}){
 try{
  if(request.method!=="GET"&&request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"מקור בקשה לא מורשה"},{status:403});
  const client=await deps.client(),auth=await client.auth.getUser();if(auth.error||!auth.data.user)return Response.json({error:"יש להתחבר"},{status:401});
  const actor=auth.data.user.id,profile=await client.from("profiles").select("role").eq("id",actor).single();const role=profile.data?.role;
  if(profile.error||!["owner","manager"].includes(role))return Response.json({error:"אין הרשאה"},{status:403});const db=deps.admin();
  if(request.method==="GET"){
   const result=await db.rpc("inventory_overview",{p_actor:actor});if(result.error)throw result.error;
   const costs=role==="owner"?await db.rpc("inventory_event_costs",{p_actor:actor,p_events:result.data.events.map((e:{id:string})=>e.id)}):{data:[],error:null};if(costs.error)throw costs.error;
   const actorLabels:Record<string,string>={[actor]:auth.data.user.email||"החשבון שלי"};
   if(role==="owner"){
    const ids=new Set<string>([...result.data.movements.map((m:{actor_id:string})=>m.actor_id),...result.data.reports.flatMap((r:{actor_id:string;confirmed_by:string|null})=>[r.actor_id,r.confirmed_by].filter(Boolean))]);
    const users=await db.auth.admin.listUsers({page:1,perPage:1000});
    if(!users.error)for(const user of users.data.users)if(ids.has(user.id))actorLabels[user.id]=(user.email||user.id).slice(0,200);
   }
   return Response.json({...result.data,costs:costs.data,role,actor,actorLabels},{headers:{"Cache-Control":"no-store, private"}});
  }
  const raw=await request.text();if(raw.length>50000)return Response.json({error:"בקשה גדולה מדי"},{status:413});const parsed=schema.safeParse(JSON.parse(raw));
  if(!parsed.success)return Response.json({error:"נתוני המלאי אינם תקינים"},{status:400});const b=parsed.data;
  if(role!=="owner"&&(b.action==="product"||b.action==="permission"||b.action==="reverse"||(b.action==="prepare"&&b.kind!=="consumption")))return Response.json({error:"הפעולה לבעלים בלבד"},{status:403});
  let result;
  if(b.action==="product")result=await db.rpc("inventory_save_product",{p_actor:actor,p_id:b.id,p_values:b.values});
  else if(b.action==="prepare")result=await db.rpc("inventory_prepare",{p_actor:actor,p_kind:b.kind,p_event:b.eventId,p_lines:b.lines,p_key:b.key,p_reason:b.reason,p_inbox:null});
  else if(b.action==="reverse")result=await db.rpc("inventory_reverse",{p_actor:actor,p_movement:b.movementId,p_key:b.key,p_reason:b.reason});
  else if(b.action==="permission")result=await db.rpc("inventory_set_receipt_permission",{p_actor:actor,p_phone:b.phone,p_enabled:b.enabled});
  else result=await db.rpc(b.action==="confirm"?"inventory_confirm":"inventory_cancel",{p_actor:actor,p_report:b.id});
  if(result.error)throw result.error;
  if(b.action==="confirm"&&result.data?.status!=="succeeded")return Response.json({error:"לא ניתן לשמור: המלאי או ההרשאות השתנו. לא נשמר דבר",status:result.data?.status},{status:409});return Response.json({result:result.data});
 }catch(error){const source=error as {code?:string;message?:string};console.error("Inventory request failed",{code:/^[A-Z0-9]{5,12}$/.test(source.code||"")?source.code:"INVENTORY_REQUEST_FAILED"});return Response.json({error:inventoryErrors[source.message||""]||"פעולת המלאי נכשלה. לא אושרה שמירה; בדקו את ההרשאות והסכמה"},{status:source.code==="42501"?403:400});}
}
