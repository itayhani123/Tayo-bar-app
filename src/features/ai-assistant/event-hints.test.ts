import test from "node:test";
import assert from "node:assert/strict";
import {eventHints,matchingVenueNames} from "./event-hints";
import {matchAttendanceEvents,type AttendanceExtraction} from "./attendance";
import {loadEventTypes,AttendanceDatabaseError} from "./attendance-service";
import type {SupabaseClient} from "@supabase/supabase-js";
const input:AttendanceExtraction={venue:"ברית באפטאון",day:17,month:11,year:2026,weekday:2,entries:[]};
const venues=[{id:"v",name:"אפטאון"}];
const events=[{id:"brit",event_date:"2026-11-17",venue_id:"v",client_name:"כהן",event_type:"Brit"},{id:"bar",event_date:"2026-11-17",venue_id:"v",client_name:"כהן",event_type:"Bar Mitzvah"}];
test("explicit Brit never matches Bar Mitzvah; date/client and ambiguity remain strict",()=>{
 assert.deepEqual(matchAttendanceEvents(input,events,venues).map(e=>e.id),["brit"]);
 assert.equal(matchAttendanceEvents({...input,venue:"אפטאון"},events,venues).length,2);
 assert.deepEqual(matchAttendanceEvents({...input,venue:"אפטאון",eventType:"בר מצווה"},events,venues).map(e=>e.id),["bar"]);
 assert.equal(matchAttendanceEvents({...input,clientName:"אחר"},events,venues).length,0);
 assert.equal(matchAttendanceEvents({...input,day:18},events,venues).length,0);
 assert.equal(matchAttendanceEvents({...input,eventType:"Bar Mitzvah"},events,venues).length,0);
 assert.equal(matchAttendanceEvents(input,events.map(e=>({id:e.id,event_date:e.event_date,venue_id:e.venue_id,client_name:e.client_name})),venues).length,0);
});
test("venue prefixes resolve only against known names, preferring exact real names",()=>{
 assert.deepEqual(eventHints({venue:"בר מצווה אפטאון"}),{venue:"אפטאון",eventType:"Bar Mitzvah"});
 assert.deepEqual(matchingVenueNames("באולם אפטאון",["אפטאון"]),["אפטאון"]);
 assert.deepEqual(matchingVenueNames("באפטאון",["באפטאון","אפטאון"]),["באפטאון"]);
});
test("unavailable legacy event-type lookup fails closed rather than selecting wrong event",async()=>{
 const db={from:()=>({select:()=>({in:()=>({abortSignal:async()=>({data:null,error:{code:"42501"}})})})})} as unknown as SupabaseClient;
 await assert.rejects(loadEventTypes(db,[{id:"x"}],"Brit",new AbortController().signal),AttendanceDatabaseError);
});
