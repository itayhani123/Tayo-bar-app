import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { attendanceCorrectionSchema, attendanceExtractionSchema } from "./attendance";
import { previewAttendance } from "./attendance-service";
import { normalizeIsraeliPhone } from "@/lib/whatsapp/phone";

const schema = z.discriminatedUnion("action",[
  z.object({ action:z.literal("configure"), phone:z.string().max(30), userId:z.uuid(), enabled:z.boolean(), autoSave:z.boolean() }).strict(),
  z.object({ action:z.literal("preview"), id:z.uuid(), correction:attendanceCorrectionSchema.optional(), allowNew:z.boolean().optional() }).strict(),
  z.object({ action:z.literal("confirm"), id:z.uuid(), proposalId:z.uuid(), confirmed:z.literal(true) }).strict(),
  z.object({ action:z.enum(["reject","retry","retryReceipt"]), id:z.uuid() }).strict(),
]);
type Dependencies = { createClient:()=>Promise<SupabaseClient>; admin:()=>SupabaseClient; preview?:typeof previewAttendance };
const json = (body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store, private"}});
export async function handleWhatsAppInbox(request:Request,deps:Dependencies) {
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(50000)]);
  try {
    if(request.method!=="GET" && request.headers.get("origin")!==new URL(request.url).origin) return json({error:"מקור בקשה אינו מורשה"},403);
    const db=await deps.createClient(); const auth=await db.auth.getUser();
    if(auth.error || !auth.data.user) return json({error:"יש להתחבר מחדש"},401);
    const actor=auth.data.user.id;
    const profile=await db.from("profiles").select("role").eq("id",actor).single();
    const role=profile.data?.role;
    if(profile.error || !["owner","manager"].includes(role)) return json({error:"אין הרשאה"},403);
    const admin=deps.admin();
    if(request.method==="GET") {
      if(new URL(request.url).searchParams.get("senders")==="1") {
        if(role!=="owner") return json({error:"לבעלים בלבד"},403);
        const [senders,profiles,users]=await Promise.all([
          admin.from("whatsapp_attendance_senders").select("phone,user_id,enabled,auto_save").order("phone"),
          admin.from("profiles").select("id,role").in("role",["owner","manager"]),
          admin.auth.admin.listUsers({page:1,perPage:1000}),
        ]);
        if(senders.error||profiles.error||users.error) throw new Error("CONFIG_READ_FAILED");
        return json({ senders:senders.data, users:profiles.data.filter(p=>users.data.users.some(u=>u.id===p.id)).map(p=>({id:p.id,role:p.role,label:users.data.users.find(u=>u.id===p.id)?.email || "משתמש ללא אימייל"})), autoEnabled:process.env.WHATSAPP_ATTENDANCE_AUTO_SAVE_ENABLED==="true" });
      }
      const history=new URL(request.url).searchParams.get("history")==="1";
      const reports=await admin.from("whatsapp_attendance_inbox").select("id,phone,status,received_at,message_text,error_code,event_id").in("status",history?["approved","rejected"]:["pending","processing","review","failed"]).order("received_at",{ascending:false}).limit(100);
      if(reports.error) throw reports.error;
      const receipts=reports.data.length ? await admin.from("whatsapp_attendance_receipts").select("inbox_id,status,error_code").in("inbox_id",reports.data.map(r=>r.id)) : {data:[],error:null};
      if(receipts.error) throw receipts.error;
      return json({reports:reports.data.map(r=>({...r,receipt:receipts.data?.find(v=>v.inbox_id===r.id)??null}))});
    }
    if(!request.headers.get("content-type")?.startsWith("application/json")) return json({error:"פורמט לא תקין"},415);
    const reader=request.body?.getReader(); if(!reader) return json({error:"בקשה ריקה"},400);
    let size=0; const parts:Uint8Array[]=[];
    const abort=()=>{void reader.cancel().catch(()=>undefined);}; signal.addEventListener("abort",abort,{once:true});
    try { while(true) { signal.throwIfAborted(); const part=await reader.read(); if(part.done) break; size+=part.value.byteLength; if(size>120000){await reader.cancel();return json({error:"בקשה גדולה מדי"},413);} parts.push(part.value); } }
    finally {signal.removeEventListener("abort",abort);reader.releaseLock();}
    let raw:unknown; try {raw=JSON.parse(Buffer.concat(parts).toString("utf8"));}catch{return json({error:"בקשה לא תקינה"},400);}
    const parsed=schema.safeParse(raw); if(!parsed.success)return json({error:"בקשה לא תקינה או חסר אישור מפורש"},400);
    const body=parsed.data;
    if(body.action==="configure") {
      if(role!=="owner")return json({error:"לבעלים בלבד"},403);
      const phone=normalizeIsraeliPhone(body.phone); if(!phone)return json({error:"נדרש מספר נייד ישראלי תקין"},400);
      const saved=await admin.rpc("configure_whatsapp_attendance_sender",{p_actor:actor,p_phone:phone,p_user:body.userId,p_enabled:body.enabled,p_auto:body.autoSave});
      if(saved.error)throw saved.error; return json({saved:true});
    }
    if(body.action==="confirm") {
      const result=await admin.rpc("approve_whatsapp_attendance",{p_actor:actor,p_inbox:body.id,p_proposal:body.proposalId}).abortSignal(signal);
      if(result.error)throw result.error;
      const data=result.data as {status:string;eventId?:string};
      return json({...data,message:data.status==="succeeded"?"כל השעות נשמרו באירוע. אישור WhatsApp הועבר לתור השליחה":"האישור אינו בתוקף או שההרשאות השתנו. יש לפתוח תצוגה חדשה"},data.status==="succeeded"?200:409);
    }
    const report=await admin.from("whatsapp_attendance_inbox").select("id,phone,actor_id,status,extracted").eq("id",body.id).single();
    if(report.error||!report.data)return json({error:"הדיווח לא נמצא"},404);
    const q=report.data;
    if(body.action==="preview") {
      if(q.status!=="review")return json({error:"הדיווח אינו ממתין לבדיקה"},409);
      const preview=await(deps.preview??previewAttendance)(admin,actor,role,attendanceExtractionSchema.parse(q.extracted),body.correction,body.allowNew??false,signal);
      const updated=await admin.from("whatsapp_attendance_inbox").update({proposal_id:preview.proposalId??null,preview}).eq("id",q.id).eq("status","review").select("id").maybeSingle();
      if(updated.error||!updated.data)return json({error:"הדיווח השתנה. יש לרענן"},409);
      return json(preview);
    }
    const result=await admin.rpc("review_whatsapp_attendance",{p_actor:actor,p_inbox:q.id,p_action:body.action});
    if(result.error)throw result.error;
    if(!result.data)return json({error:"מצב הדיווח השתנה. יש לרענן"},409);
    return json({saved:true});
  }catch{return json({error:"לא ניתן להשלים את הבקשה. לאחר ניסיון שמירה יש לנסות שוב את אותו אישור בבטחה"},503);}
}
