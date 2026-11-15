import assert from "node:assert/strict";
import test from "node:test";
import {attendanceSummary,parseAttendanceDecision,splitAttendanceMessage} from "./attendance-messages";
import {buildAttendanceRows} from "@/features/ai-assistant/attendance";
import {extracted,employees} from "@/features/ai-assistant/attendance-fixture";
import {deliverAttendanceMessage,AttendanceDeliveryError} from "./attendance-delivery";
test("summary includes eight employees, roles, midnight, unknown identities and missing hours without payroll",()=>{
 const rows=buildAttendanceRows(extracted,employees,[],"2026-11-12");
 const text=attendanceSummary({extracted,employees,rows,eventId:"event",events:[{id:"event",event_date:"2026-11-12",venue_id:"v",venueName:"קסנאדו",client_name:"אירוע בדיקה"}],issues:[]}).join("\n");
 assert.match(text,/8/);assert.match(text,/פתיחה/);assert.match(text,/למחרת/);assert.match(text,/רועי לוי/);assert.match(text,/דיווח נוכחות לאישור/);assert.match(text,/יתווסף לשיבוץ האירוע בעת האישור/);assert.doesNotMatch(text,/₪|hourly_rate|UUID|אישור נפרד|לביטול:|בטל [A-F0-9]{10}/);
 const unknown=attendanceSummary({extracted,employees,rows:[{...rows[0],employeeId:null,end:"",minutes:null,issues:["שעה חסרה"]}],events:[],eventId:null,issues:["אירוע לא מזוהה"]}).join("\n");
 assert.match(unknown,/לא מצאתי במערכת עובד/);assert.match(unknown,/לא מצאתי אירוע/);
 for(const part of splitAttendanceMessage("🧑".repeat(10000)))assert.ok(part.length<=3500);
});
test("only exact token-bound button IDs are accepted; text commands are disabled",()=>{
 const report="11111111-1111-4111-8111-111111111111",token="22222222-2222-4222-8222-222222222222";
 assert.deepEqual(parseAttendanceDecision(`attendance:confirm:${report}:${token}`),{decision:"confirm",inboxId:report,token});
 assert.equal(parseAttendanceDecision(`בטל ${report} ${token}`),null);
 assert.equal(parseAttendanceDecision("אשר A123BC456D"),null);
 assert.equal(parseAttendanceDecision("אשר A123BC456D עוד"),null);
 for(const input of["כן","מאשר",`אשר ${report}`,`אשר ${report} ${token} עוד`])assert.equal(parseAttendanceDecision(input),null);
});

test("single unassigned worker preview is friendly, includes exact duration, and ambiguity blocks the summary",()=>{
 const input={...extracted,day:15,month:11,year:2026,weekday:0,venue:"אפטאון",entries:[{name:"יונתן לולו",time:"12:30",direction:"in" as const,note:null},{name:"יונתן לולו",time:"17:35",direction:"out" as const,note:null}]};
 const staff=[{id:"employee",full_name:"יונתן לולו"}];
 const rows=buildAttendanceRows(input,staff,[],"2026-11-15");
 const text=attendanceSummary({extracted:input,employees:staff,rows,eventId:"event",events:[{id:"event",event_date:"2026-11-15",venue_id:"v",venueName:"אפטאון",client_name:"מעיין"}],issues:[]}).join("\n");
 assert.match(text,/אפטאון — מעיין/);assert.match(text,/15\.11\.2026/);assert.match(text,/12:30–17:35/);assert.match(text,/5 שעות ו־5 דקות/);
 assert.doesNotMatch(text,/employee|event|UUID|token|אישור נפרד/);
 const ambiguous=attendanceSummary({extracted:input,employees:staff,rows:[{...rows[0],employeeId:null,candidates:[...staff,{id:"other",full_name:"יונתן אחר"}]}],events:[],eventId:null,issues:[]}).join("\n");
 assert.match(ambiguous,/מתאים לכמה עובדים/);assert.match(ambiguous,/לא ניתן לשמור/);
});
test("Meta delivery sends actual reply buttons and never falls back to text on rejection",async()=>{
 const config={token:"synthetic-token",phoneId:"existing-phone-id",version:"v-test",language:"he",replyButtons:true};const buttons=[{id:"attendance:confirm:id:token",title:"אשר דיווח"}];
 const types:string[]=[];
 const fetcher:typeof fetch=async(url,options)=>{assert.equal(url,"https://graph.facebook.com/v-test/existing-phone-id/messages");const body=JSON.parse(options?.body as string);types.push(body.type);if(body.type==="interactive"){assert.equal(body.interactive.action.buttons[0].reply.title,"אשר דיווח");return Response.json({error:{code:131009}},{status:400});}return Response.json({messages:[{id:"accepted"}]});};
 await assert.rejects(deliverAttendanceMessage(config,"972501234567","report",false,buttons,fetcher),(error:unknown)=>error instanceof AttendanceDeliveryError&&error.code==="META_BUTTONS_NOT_ACCEPTED"&&error.metaCode===131009&&error.httpStatus===400&&!error.retryable);assert.deepEqual(types,["interactive"]);
 let sent=0;assert.equal(await deliverAttendanceMessage(config,"972501234567","report",false,buttons,async(_url,options)=>{const body=JSON.parse(options?.body as string);assert.equal(body.type,"interactive");assert.equal(body.interactive.type,"button");assert.equal(body.interactive.action.buttons[0].reply.id,buttons[0].id);sent++;return Response.json({messages:[{id:"accepted"}]});}),"accepted");assert.equal(sent,1);
 await assert.rejects(deliverAttendanceMessage({...config,replyButtons:false},"972501234567","report",false,buttons,fetcher),/INTERACTIVE_REQUIRED/);
 let attempts=0;await assert.rejects(deliverAttendanceMessage(config,"972501234567","test",false,buttons,async()=>{attempts++;throw new Error("unknown upstream outcome");}),/META_DELIVERY_NOT_VERIFIED/);assert.equal(attempts,1);
 await assert.rejects(deliverAttendanceMessage(config,"972501234567","test",true,buttons,fetcher),/APPROVED_TEMPLATE_REQUIRED/);
});
