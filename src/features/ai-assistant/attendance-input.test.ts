import assert from "node:assert/strict";
import test from "node:test";
import {attendanceRangeEntries,AttendanceInputError} from "./attendance-input";
import {extractAttendance} from "./attendance-service";

export const report1946="יום ראשון 15/11\nאפטאון\nיונתן לולו 12:30-17:35";
export const report1950=report1946;
export const report1959=report1946+"\nרועי כהן 11:30-17:3";
test("15 November reports preserve the two exact clocks and reject the ambiguous digit instead of guessing",()=>{
 const entries=attendanceRangeEntries(report1946)!;assert.equal(entries.length,2);assert.deepEqual(entries.map(r=>r.time),["12:30","17:35"]);
 assert.deepEqual(attendanceRangeEntries(report1950),entries);
 assert.throws(()=>attendanceRangeEntries(report1959),(error:unknown)=>error instanceof AttendanceInputError&&/17:3/.test(error.message));
 assert.equal(attendanceRangeEntries(report1959.replace(/17:3$/,"17:30"))?.length,4);
});

test("17:3 is rejected before client configuration, even when the API key is missing",async()=>{
 const key=process.env.OPENAI_API_KEY;try{delete process.env.OPENAI_API_KEY;await assert.rejects(extractAttendance(report1959,new AbortController().signal),AttendanceInputError);}finally{if(key!==undefined)process.env.OPENAI_API_KEY=key;}
});
