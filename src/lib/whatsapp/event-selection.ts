import type {AttendancePreview} from "@/features/ai-assistant/attendance";
import {splitAttendanceMessage} from "./attendance-messages";

export const EVENT_SELECTION_POLICY="attendance_event_selection_v1";
const uuid="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export function parseEventSelectionButton(value:string){
 const match=new RegExp(`^attendance:choose:(${uuid}):(${uuid}):(${uuid}|cancel)$`,"i").exec(value);
 return match?{inboxId:match[1],token:match[2],eventId:match[3].toLowerCase()==="cancel"?null:match[3],action:match[3].toLowerCase()==="cancel"?"cancel":"select"}:null;
}
export const isEventSelectionText=(text:string)=>/^\s*(?:\d{1,3}[.)]?|בטל|ביטול)\s*$/.test(text);
export function eventSelectionParts(preview:AttendancePreview){
 if(preview.eventId||preview.events.length<2||preview.events.length>20)throw new Error("INVALID_EVENT_SELECTION");
 const labels:Record<string,string>={Brit:"ברית","Bar Mitzvah":"בר מצווה","Bat Mitzvah":"בת מצווה",Wedding:"חתונה",Henna:"חינה",Business:"עסקי",Other:"אחר"};
 const field=(value:string)=>value.replace(/[\r\n|\u202a-\u202e\u2066-\u2069]/g," ").replace(/\s+/g," ").trim().slice(0,160);
 return splitAttendanceMessage([
  "נמצאו כמה אירועים מתאימים. בחרו אירוע לפני אישור השעות:",
  ...preview.events.map((e,i)=>`${i+1}. ${field(e.venueName)} | ${field(e.event_date.split('-').reverse().join('.'))} | ${field(labels[e.event_type||'']||e.event_type||'סוג לא צוין')}${e.client_name?` | ${field(e.client_name)}`:''}`),
  "השיבו במספר האפשרות, או השתמשו בכפתור. כשיש כמה רשימות, השיבו להודעת הרשימה המתאימה.",
  "הבחירה תקפה ל־10 דקות. אפשר להשיב בטל. לאחר הבחירה יישלח סיכום לאישור נוסף. עדיין לא נשמרו שעות.",
 ].join('\n'),900);
}
