import {z} from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";
import {inventoryOverviewSchema,inventoryCostsSchema,inventoryDataSchema} from "./contract";
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
 const diagnosticId=crypto.randomUUID();let operation="authentication";
 try{
  if(request.method!=="GET"&&request.headers.get("origin")!==new URL(request.url).origin)return Response.json({error:"מקור בקשה לא מורשה"},{status:403});
  const client=await deps.client(),auth=await client.auth.getUser();if(auth.error||!auth.data.user)return Response.json({error:"יש להתחבר"},{status:401});
  const actor=auth.data.user.id,profile=await client.from("profiles").select("role").eq("id",actor).single();const role=profile.data?.role;
  if(profile.error||!["owner","manager"].includes(role))return Response.json({error:"אין הרשאה"},{status:403});const db=deps.admin();
  if(request.method==="GET"){
   operation="inventory_overview";
   const result=await db.rpc("inventory_overview",{p_actor:actor});if(result.error)throw result.error;
   const overview=inventoryOverviewSchema.safeParse(result.data);
   if(!overview.success){console.error("Inventory response contract mismatch",{diagnosticId,operation,fields:[...new Set(overview.error.issues.map(i=>String(i.path[0]??"root")))]});throw{code:"INVENTORY_RESPONSE_INVALID"};}
   const data=overview.data;operation="inventory_event_costs";
   const costs=role==="owner"?await db.rpc("inventory_event_costs",{p_actor:actor,p_events:data.events.map(e=>e.id)}):{data:[],error:null};if(costs.error)throw costs.error;
   const validatedCosts=inventoryCostsSchema.safeParse(costs.data);if(!validatedCosts.success)throw{code:"INVENTORY_RESPONSE_INVALID"};
   const actorLabels:Record<string,string>={[actor]:auth.data.user.email||"החשבון שלי"};
   if(role==="owner"){
    const ids=new Set<string>([...data.movements.map(m=>m.actor_id),...data.reports.flatMap(r=>[r.actor_id,r.confirmed_by].filter((id):id is string=>typeof id==="string"))]);
    const users=await db.auth.admin.listUsers({page:1,perPage:1000});
    if(!users.error)for(const user of users.data.users)if(ids.has(user.id))actorLabels[user.id]=(user.email||user.id).slice(0,200);
   }
   operation="inventory_response";
   const response=inventoryDataSchema.safeParse({...data,costs:validatedCosts.data,role,actor,actorLabels});if(!response.success)throw{code:"INVENTORY_RESPONSE_INVALID"};
   return Response.json(response.data,{headers:{"Cache-Control":"no-store, private"}});
  }
  const raw=await request.text();if(raw.length>50000)return Response.json({error:"בקשה גדולה מדי"},{status:413});const parsed=schema.safeParse(JSON.parse(raw));
  if(!parsed.success)return Response.json({error:"נתוני המלאי אינם תקינים"},{status:400});const b=parsed.data;
  if(role!=="owner"&&(b.action==="product"||b.action==="permission"||b.action==="reverse"||(b.action==="prepare"&&b.kind!=="consumption")))return Response.json({error:"הפעולה לבעלים בלבד"},{status:403});
  operation=`inventory_${b.action}`;let result;
  if(b.action==="product")result=await db.rpc("inventory_save_product",{p_actor:actor,p_id:b.id,p_values:b.values});
  else if(b.action==="prepare")result=await db.rpc("inventory_prepare",{p_actor:actor,p_kind:b.kind,p_event:b.eventId,p_lines:b.lines,p_key:b.key,p_reason:b.reason,p_inbox:null});
  else if(b.action==="reverse")result=await db.rpc("inventory_reverse",{p_actor:actor,p_movement:b.movementId,p_key:b.key,p_reason:b.reason});
  else if(b.action==="permission")result=await db.rpc("inventory_set_receipt_permission",{p_actor:actor,p_phone:b.phone,p_enabled:b.enabled});
  else result=await db.rpc(b.action==="confirm"?"inventory_confirm":"inventory_cancel",{p_actor:actor,p_report:b.id});
  if(result.error)throw result.error;
  if(b.action==="confirm"&&result.data?.status!=="succeeded")return Response.json({error:"לא ניתן לשמור: המלאי או ההרשאות השתנו. לא נשמר דבר",status:result.data?.status},{status:409});return Response.json({result:result.data});
 }catch(error){
  const source=error as {code?:string;message?:string};const originalCode=/^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(source.code||"")?source.code:undefined;
  const schemaMissing=["42703","42883","42P01","PGRST202","PGRST204","PGRST205"].includes(originalCode||"");
  const invalidResponse=source.code==="INVENTORY_RESPONSE_INVALID",known=inventoryErrors[source.message||""];
  const code=schemaMissing?"INVENTORY_SCHEMA_MISSING":invalidResponse?"INVENTORY_RESPONSE_INVALID":originalCode==="42501"?"INVENTORY_PERMISSION_DENIED":"INVENTORY_REQUEST_FAILED";
  const message=schemaMissing?"סכמת המלאי אינה מעודכנת. יש לבדוק שמיגרציות 027 ו־028 הוחלו בפרויקט Supabase של הפריסה.":invalidResponse?"נתוני המלאי אינם תואמים לגרסת האפליקציה. יש לבדוק את גרסת השרת ופונקציית inventory_overview.":known||"פעולת המלאי נכשלה. לא אושרה שמירה; נסו שוב או פנו לבעלים.";
  console.error("Inventory request failed",{diagnosticId,operation,code,originalCode,safeMessage:message});
  return Response.json({error:message,code,diagnosticId},{status:schemaMissing||invalidResponse?503:source.code==="42501"?403:known||error instanceof SyntaxError?400:originalCode==="23505"?409:500,headers:{"Cache-Control":"no-store, private"}});
 }
}
