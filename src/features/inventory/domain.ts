import {z} from "zod";
import {eventHints,matchingVenueNames,normalizeEventText} from "@/features/ai-assistant/event-hints";
import {classifyWhatsAppReport} from "@/lib/whatsapp/report-routing";
export const INVENTORY_POLICY="inventory_bottles_v1";
export const inventoryExtractionSchema=z.object({kind:z.enum(["consumption","receipt","unsupported"]),venue:z.string().nullable(),eventType:z.string().nullable().optional(),clientName:z.string().nullable().optional(),day:z.number().int().min(1).max(31).nullable(),month:z.number().int().min(1).max(12).nullable(),year:z.number().int().min(1900).max(2200).nullable(),entries:z.array(z.object({name:z.string().min(1).max(150),quantity:z.number().nullable()}).strict()).max(100)}).strict();
export type InventoryExtraction=z.infer<typeof inventoryExtractionSchema>;
export type Product={id:string;name:string;category:string;bottle_ml:number;stock_qty:number;minimum_qty:number;active:boolean;aliases:string[];cost_agorot?:string;value_agorot?:string};
export type InventoryEvent={id:string;event_date:string;client_name:string;venue_name:string;event_type?:string};
export type InventoryLine={product_id:string;quantity:number};
export function isInventoryMessage(text:string){return classifyWhatsAppReport(text).startsWith("inventory_");}
const normalize=(text:string)=>text.normalize("NFKC").replace(/[\u200e\u200f״׳'".,()\-–]/g,"").replace(/\s+/g," ").trim().toLowerCase();
export function cleanInventoryProductName(name:string,quantity:number,source:string){
 const unit=/^(בקבוקי|בקבוקים|בקבוק)\s+(?:של\s+)?(.+)$/.exec(name.trim());
 if(!unit)return name;
 const escaped=name.trim().replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/\s+/g,"\\s+");
 return new RegExp(`(?:^|[^\\d])${quantity}\\s+${escaped}(?=$|[\\s,.;])`).test(source)?unit[2]:name;
}
export function resolveInventory(input:InventoryExtraction,products:Product[],events:InventoryEvent[],source=""){
 if(input.kind==="unsupported"||!input.entries.length)throw new Error("לא זוהה דיווח צריכה או קליטת מלאי. שלחו סוג פעולה, שמות מוצרים וכמויות שלמות.");
 let event:InventoryEvent|undefined;
 if(input.kind==="consumption"){
  const hints=eventHints(input),venues=matchingVenueNames(hints.venue,events.map(e=>e.venue_name));
  const matches=events.filter(e=>venues.includes(e.venue_name)&&(!hints.eventType||e.event_type===hints.eventType)&&(!input.clientName||normalizeEventText(e.client_name)===normalizeEventText(input.clientName))&&(!input.day||+e.event_date.slice(8,10)===input.day)&&(!input.month||+e.event_date.slice(5,7)===input.month)&&(!input.year||+e.event_date.slice(0,4)===input.year));
  if(matches.length!==1)throw new Error(matches.length?"נמצאו כמה אירועים אפשריים. שלחו אולם ותאריך מלא, כולל שנה.":`לא נמצא אירוע מתאים ב${input.venue||"אולם שצוין"}. בדקו את האולם והתאריך.`);event=matches[0];
 }
 const selected=new Set<string>();
 const lines=input.entries.map(entry=>{
  if(!Number.isInteger(entry.quantity)||!entry.quantity||entry.quantity<1||entry.quantity>100000)throw new Error(`הכמות עבור "${entry.name}" צריכה להיות מספר בקבוקים שלם וחיובי.`);
  const find=(candidate:string)=>products.filter(p=>p.active&&[p.name,...p.aliases,`${p.name} ${p.bottle_ml} מ״ל`,`${p.name} ${p.bottle_ml}`].some(name=>normalize(name)===normalize(candidate)));
  const direct=find(entry.name);
  const name=direct.length?entry.name:cleanInventoryProductName(entry.name,entry.quantity!,source);
  const matches=direct.length?direct:find(name);
  if(matches.length!==1)throw new Error(matches.length?`יש כמה מוצרים בשם "${name}". ציינו גם נפח בקבוק.`:`לא נמצא מוצר בשם "${name}". יש לבחור מוצר קיים.`);
  const product=matches[0];if(selected.has(product.id))throw new Error(`המוצר "${product.name}" מופיע יותר מפעם אחת. שלחו שורה אחת לכל מוצר.`);selected.add(product.id);
  if(input.kind==="consumption"&&product.stock_qty<entry.quantity)throw new Error(`אין מספיק מלאי של ${product.name} (${product.bottle_ml} מ״ל). זמינים ${product.stock_qty} בקבוקים, דווחו ${entry.quantity}. לא נשמר דבר.`);
  return {product_id:product.id,quantity:entry.quantity};
 });return{event,lines};
}
export function inventorySummary(kind:string,event:InventoryEvent|undefined,lines:InventoryLine[],products:Product[]){return[kind==="receipt"?"📦 קליטת מלאי לאישור":"📦 דיווח צריכת אלכוהול",...(event?[`📍 ${event.venue_name} — ${event.client_name}`,`📅 ${event.event_date.split("-").reverse().join(".")}`]:[]),"",...lines.map(line=>{const p=products.find(p=>p.id===line.product_id)!;return`${p.name} (${p.bottle_ml} מ״ל): ${line.quantity} בקבוקים`;}),"",`סה״כ: ${lines.reduce((sum,l)=>sum+l.quantity,0)} בקבוקים`].join("\n");}
export function parseInventoryButton(value:string){const uuid="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";const match=new RegExp(`^inventory:(confirm|cancel):${uuid}:${uuid}$`,"i").exec(value);return match?{decision:match[1],inboxId:match[2],token:match[3]}:null;}
export function parseAgorot(value:string){if(!/^\d{1,8}(?:\.\d{1,2})?$/.test(value))throw new Error("יש להזין מחיר בשקלים, עד שתי ספרות אחרי הנקודה.");const[a,b=""]=value.split(".");const amount=BigInt(a)*BigInt(100)+BigInt(b.padEnd(2,"0"));if(amount>BigInt(1000000000))throw new Error("המחיר חורג מהטווח המותר");return amount.toString();}
export function formatAgorot(value:string){const n=BigInt(value),abs=n<BigInt(0)?-n:n;return`${n<BigInt(0)?"-":""}₪${(abs/BigInt(100)).toLocaleString("he-IL")}.${(abs%BigInt(100)).toString().padStart(2,"0")}`;}
