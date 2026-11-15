"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppRole } from "@/lib/auth/user";
import { AttendanceCard } from "./attendance-card";
import type { AttendancePreview, AttendanceCorrection } from "./attendance";

async function api(body?:unknown,query="") {
 const response=await fetch(`/api/whatsapp/attendance${query}`,{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined,cache:"no-store",signal:AbortSignal.timeout(55000)});
 const data=await response.json(); if(!response.ok)throw new Error(data.error||data.message||"הפעולה נכשלה");return data;
}
type Report={id:string;phone:string;status:string;received_at:string;message_text:string;error_code:string|null;event_id:string|null;receipt:{status:string;error_code:string|null}|null};
type Sender={phone:string;user_id:string;enabled:boolean;auto_save:boolean};
type Config={senders:Sender[];users:{id:string;label:string;role:string}[];autoEnabled:boolean};
const labels:Record<string,string>={pending:"בתור לעיבוד",processing:"בפענוח",review:"ממתין לאישור",approved:"נשמר באירוע",failed:"העיבוד נכשל",rejected:"נדחה",sent:"האישור נשלח ל־WhatsApp",delivered:"האישור נמסר",read:"האישור נקרא",expired:"דרושה תבנית מאושרת לשליחת אישור"};
export function WhatsAppAttendanceInbox({role}:{role:AppRole}) {
 const cache=useQueryClient();const[history,setHistory]=useState(false);const[busy,setBusy]=useState(false);const[error,setError]=useState("");
 const[active,setActive]=useState<{id:string;preview:AttendancePreview;version:string}|null>(null);
 const[phone,setPhone]=useState("");const[userId,setUserId]=useState("");const[enabled,setEnabled]=useState(true);const[autoSave,setAutoSave]=useState(false);
 const reports=useQuery({queryKey:["whatsapp-attendance",history],queryFn:()=>api(undefined,history?"?history=1":"") as Promise<{reports:Report[]}>,refetchInterval:15000});
 const config=useQuery({queryKey:["whatsapp-attendance-senders"],queryFn:()=>api(undefined,"?senders=1") as Promise<Config>,enabled:role==="owner"});
 async function act(body:unknown,openId?:string){if(busy)return;setBusy(true);setError("");try{const data=await api(body);if(openId)setActive({id:openId,preview:data,version:crypto.randomUUID()});await cache.invalidateQueries({queryKey:["whatsapp-attendance"]});await cache.invalidateQueries({queryKey:["whatsapp-attendance-senders"]});}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section dir="rtl" className="mx-auto mt-6 w-full max-w-4xl space-y-4 rounded-2xl border bg-white p-4" aria-label="דיווחי נוכחות מוואטסאפ">
  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">דיווחי נוכחות מ־WhatsApp</h2><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={history} onChange={e=>setHistory(e.target.checked)} />הצגת דיווחים שנשמרו או נדחו</label></div>
  <p className="text-sm text-slate-600">דיווחים ממספרים מורשים נשמרים לבדיקה. שעות העבודה מתעדכנות רק לאחר אישור.</p>
  {(error||reports.error) && <p role="alert" className="text-sm text-red-700">{error||"לא ניתן לטעון דיווחים. ודאו שהפעלת הקליטה הושלמה"}</p>}
  {reports.isLoading&&<p role="status">טוען דיווחים…</p>}
  {!reports.isLoading&&!reports.data?.reports.length&&<p className="text-sm text-slate-500">אין דיווחים להצגה</p>}
  {reports.data?.reports.map(report=><article key={report.id} className="space-y-2 rounded-xl border p-3"><p className="text-sm font-medium">{report.phone} · {new Intl.DateTimeFormat("he-IL",{timeZone:"Asia/Jerusalem",dateStyle:"short",timeStyle:"short"}).format(new Date(report.received_at))} · {labels[report.status]||report.status}</p><details><summary className="cursor-pointer text-sm">הודעת המקור</summary><p className="whitespace-pre-wrap text-sm">{report.message_text}</p></details>
   {report.receipt&&<p className="text-sm">{report.receipt.status==='failed'?"שליחת אישור WhatsApp נכשלה; השעות כבר שמורות":labels[report.receipt.status]||"אישור WhatsApp בתור לשליחה"}</p>}
   <div className="flex flex-wrap gap-2">{report.status==="review"&&<><button disabled={busy} className="min-h-11 rounded border px-3 text-sm" onClick={()=>void act({action:"preview",id:report.id},report.id)}>בדיקה ותצוגה לאישור</button><button disabled={busy} className="min-h-11 rounded border px-3 text-sm" onClick={()=>void act({action:"reject",id:report.id})}>דחיית הדיווח</button></>}{report.status==="failed"&&<button disabled={busy} className="min-h-11 rounded border px-3 text-sm" onClick={()=>void act({action:"retry",id:report.id})}>ניסיון פענוח נוסף</button>}{report.receipt&&["failed","expired"].includes(report.receipt.status)&&<button disabled={busy} className="min-h-11 rounded border px-3 text-sm" onClick={()=>void act({action:"retryReceipt",id:report.id})}>נסה שוב לשלוח אישור</button>}</div>
   {active?.id===report.id&&report.status==="review"&&<AttendanceCard key={active.version} initial={active.preview} onBusyChange={setBusy} onSaved={()=>{void cache.invalidateQueries({queryKey:["whatsapp-attendance"]});}} request={async raw=>{const body=raw as {action:string;proposalId?:string;confirmed?:boolean;correction?:AttendanceCorrection;allowNew?:boolean};return api(body.action==="confirm"?{action:"confirm",id:report.id,proposalId:body.proposalId,confirmed:true}:{action:"preview",id:report.id,correction:body.correction,allowNew:body.allowNew});}}/>}
  </article>)}
  {role==="owner"&&<details className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">הרשאת שולחי דיווחים</summary><p className="my-2 text-sm">יש לשייך מספר אישי לחשבון מנהל או בעלים קיים לאחר אימות בעלות על המספר מול אותו אדם.</p>
   {config.error&&<p role="alert">לא ניתן לטעון הרשאות שולחים</p>}
   <div className="space-y-2">{config.data?.senders.map(s=><button type="button" key={s.phone} disabled={busy} className="block min-h-11 w-full rounded border p-2 text-right text-sm" onClick={()=>{setPhone(s.phone);setUserId(s.user_id);setEnabled(s.enabled);setAutoSave(s.auto_save);}}>{s.phone} · {config.data?.users.find(u=>u.id===s.user_id)?.label||"חשבון ללא הרשאה פעילה"} · {s.enabled?"פעיל":"מושבת"}</button>)}</div>
   <form className="mt-3 space-y-3" onSubmit={e=>{e.preventDefault();void act({action:"configure",phone,userId,enabled,autoSave});}}>
    <label className="block text-sm">מספר WhatsApp אישי<input required type="tel" value={phone} onChange={e=>setPhone(e.target.value)} className="block min-h-11 w-full rounded border p-2" /></label>
    <label className="block text-sm">חשבון משתמש<select required value={userId} onChange={e=>setUserId(e.target.value)} className="block min-h-11 w-full rounded border p-2"><option value="">בחרו חשבון</option>{config.data?.users.map(u=><option key={u.id} value={u.id}>{u.label} · {u.role==="owner"?"בעלים":"מנהל"}</option>)}</select></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />הרשאת דיווח פעילה</label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={autoSave} onChange={e=>setAutoSave(e.target.checked)} />אישור שמירה אוטומטית עתידית לדיווח חד־משמעי על עובדים שכבר משובצים ושעותיהם ריקות</label>
    <p className="text-xs text-slate-500">{config.data?.autoEnabled?"שמירה אוטומטית מופעלת בשרת רק לשולחים שסומנו במפורש":"בשלב הנוכחי שמירה אוטומטית כבויה בשרת; כל דיווח דורש אישור באפליקציה"}</p>
    <button disabled={busy||!userId||!phone} className="min-h-11 rounded bg-slate-950 px-4 text-sm text-white disabled:opacity-40">שמירת הרשאת שולח</button>
   </form></details>}
 </section>;
}
