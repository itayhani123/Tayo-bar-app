import assert from "node:assert/strict";
import test from "node:test";
import {attendanceSummary,parseAttendanceDecision,splitAttendanceMessage} from "./attendance-messages";
import {buildAttendanceRows} from "@/features/ai-assistant/attendance";
import {extracted,employees} from "@/features/ai-assistant/attendance-fixture";
import {deliverAttendanceMessage} from "./attendance-delivery";
test("summary includes eight employees, roles, midnight, unknown identities and missing hours without payroll",()=>{
 const rows=buildAttendanceRows(extracted,employees,[],"2026-11-12");
 const text=attendanceSummary({extracted,employees,rows,eventId:"event",events:[{id:"event",event_date:"2026-11-12",venue_id:"v",venueName:"קסנאדו",client_name:"אירוע בדיקה"}],issues:[]}).join("\n");
 assert.match(text,/8/);assert.match(text,/פתיחה/);assert.match(text,/למחרת/);assert.match(text,/רועי לוי/);assert.match(text,/טרם נשמר/);assert.doesNotMatch(text,/₪|hourly_rate/);
 const unknown=attendanceSummary({extracted,employees,rows:[{...rows[0],employeeId:null,end:"",minutes:null,issues:["שעה חסרה"]}],events:[],eventId:null,issues:["אירוע לא מזוהה"]}).join("\n");
 assert.match(unknown,/עובד לא מזוהה/);assert.match(unknown,/יציאה חסרה/);
 for(const part of splitAttendanceMessage("🧑".repeat(10000)))assert.ok(part.length<=3500);
});
test("only exact token-bound button IDs or Hebrew commands are accepted",()=>{
 const report="11111111-1111-4111-8111-111111111111",token="22222222-2222-4222-8222-222222222222";
 assert.deepEqual(parseAttendanceDecision(`attendance:confirm:${report}:${token}`),{decision:"confirm",inboxId:report,token});
 assert.equal(parseAttendanceDecision(`בטל ${report} ${token}`)?.decision,"cancel");
 for(const input of["כן","מאשר",`אשר ${report}`,`אשר ${report} ${token} עוד`])assert.equal(parseAttendanceDecision(input),null);
});
test("Meta delivery uses existing Cloud API, reply buttons and safe text fallback only for explicit unsupported-payload rejection",async()=>{
 const config={token:"synthetic-token",phoneId:"existing-phone-id",version:"v-test",language:"he",replyButtons:true};const buttons=[{id:"attendance:confirm:id:token",title:"אשר דיווח"}];
 const types:string[]=[];
 const fetcher:typeof fetch=async(url,options)=>{assert.equal(url,"https://graph.facebook.com/v-test/existing-phone-id/messages");const body=JSON.parse(options?.body as string);types.push(body.type);if(body.type==="interactive"){assert.equal(body.interactive.action.buttons[0].reply.title,"אשר דיווח");return Response.json({error:{code:131009}},{status:400});}return Response.json({messages:[{id:"accepted"}]});};
 assert.equal(await deliverAttendanceMessage(config,"972501234567","commands and report",false,buttons,fetcher),"accepted");assert.deepEqual(types,["interactive","text"]);
 let attempts=0;await assert.rejects(deliverAttendanceMessage(config,"972501234567","test",false,buttons,async()=>{attempts++;throw new Error("unknown upstream outcome");}),/META_DELIVERY_NOT_VERIFIED/);assert.equal(attempts,1);
 await assert.rejects(deliverAttendanceMessage(config,"972501234567","test",true,buttons,fetcher),/APPROVED_TEMPLATE_REQUIRED/);
});
