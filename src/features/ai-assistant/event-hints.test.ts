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
const productionVenues=["קסנאדו","אפטאון","אמורה","אחר"];
test("all four existing halls resolve with spacing, Hebrew location prefixes and formatting marks",()=>{
 for(const hall of productionVenues){
  for(const input of [hall,`אולם ${hall}`,`באולם ${hall}`,`ב${hall}`,`  אולם   ${hall}  `,`\u200fאולם ${hall}\u200e`]){
   assert.deepEqual(matchingVenueNames(input,productionVenues),[hall],input);
  }
 }
});
test("observed spelling alias resolves after removing unit-free venue prefix",()=>{
 assert.deepEqual(matchingVenueNames("אולם קסאנאדו",productionVenues),["קסנאדו"]);
 assert.deepEqual(matchingVenueNames("באולם קסאנאדו",productionVenues),["קסנאדו"]);
 assert.deepEqual(matchingVenueNames("בקסאנאדו",productionVenues),["קסנאדו"]);
 const hall={id:"x",name:"קסנאדו"};
 assert.deepEqual(matchAttendanceEvents({...input,venue:"אולם קסאנאדו",eventType:"Brit"},events.map(e=>({...e,venue_id:"x"})),[hall]).map(e=>e.id),["brit"]);
 assert.equal(matchAttendanceEvents({...input,venue:"אולם קסאנאדו",eventType:"Bar Mitzvah"},events.filter(e=>e.id==="brit").map(e=>({...e,venue_id:"x"})),[hall]).length,0);
});
test("alias never fabricates halls, overrides exact real names or removes arbitrary Hebrew letters",()=>{
 assert.deepEqual(matchingVenueNames("אולם קסאנאדו",productionVenues.filter(n=>n!=="קסנאדו")),[]);
 assert.deepEqual(matchingVenueNames("אולם קסאנאדו",[...productionVenues,"קסאנאדו"]),["קסאנאדו"]);
 for(const unknown of ["קסנדו","קסנדה","אמורא","אפטון","אולם לא קיים"]){
  assert.deepEqual(matchingVenueNames(unknown,productionVenues),[]);
 }
 assert.equal(matchAttendanceEvents({...input,venue:"אולם קסאנאדו"},events.map(e=>({...e,venue_id:"x"})),[{id:"x",name:"קסנאדו"}]).length,2);
});
test("unavailable legacy event-type lookup fails closed rather than selecting wrong event",async()=>{
 const db={from:()=>({select:()=>({in:()=>({abortSignal:async()=>({data:null,error:{code:"42501"}})})})})} as unknown as SupabaseClient;
 await assert.rejects(loadEventTypes(db,[{id:"x"}],"Brit",new AbortController().signal),AttendanceDatabaseError);
});
