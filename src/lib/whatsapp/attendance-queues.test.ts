import assert from "node:assert/strict";
import test from "node:test";
import {drainAttendanceQueues} from "./attendance-queues";
test("queue stages drain multiple inbound messages and an inbox failure cannot starve outbound or decisions",async()=>{
 let incoming=3,outgoing=0,decisions=1;
 const sent:number[]=[];
 const result=await drainAttendanceQueues(new AbortController().signal,{
  decision:async()=>decisions-- >0?1:0,
  inbox:async()=>{if(incoming>0){incoming--;outgoing++;return 1;}return 0;},
  outbox:async()=>{if(outgoing>0){sent.push(outgoing--);return 1;}return 0;},
 });
 assert.equal(result.counts.inbox,3);assert.equal(result.counts.outbox,3);assert.equal(sent.length,3);
 let deliveries=0;
 const failed=await drainAttendanceQueues(new AbortController().signal,{decision:async()=>0,inbox:async()=>{throw new Error("private upstream failure");},outbox:async()=>deliveries++===0?1:0});
 assert.deepEqual(failed.errors,["inbox"]);assert.equal(failed.counts.outbox,1);
});
