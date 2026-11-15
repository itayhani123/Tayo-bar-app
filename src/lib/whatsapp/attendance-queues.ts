type Stage="decision"|"inbox"|"outbox";
type Step=(signal:AbortSignal)=>Promise<number>;
export async function drainAttendanceQueues(signal:AbortSignal,steps:Record<Stage,Step>,now:()=>number=Date.now){
 const deadline=now()+100000,disabled=new Set<Stage>();
 const counts={decision:0,inbox:0,outbox:0},errors:Stage[]=[];
 for(let round=0;round<5&&!signal.aborted&&now()<deadline;round++){
  let progress=0;
  for(const stage of ["decision","outbox","inbox","outbox"] as const){
   const remaining=deadline-now();
   // Reserve time to send replies even if OpenAI times out. One failing stage
   // never prevents an independent queue from being drained.
   if(disabled.has(stage)||signal.aborted||remaining<=0||(stage==="inbox"&&remaining<40000))continue;
   try{
    const count=await steps[stage](AbortSignal.any([signal,AbortSignal.timeout(Math.min(remaining,stage==="inbox"?35000:15000))]));
    counts[stage]+=count;progress+=count;
   }catch{
    disabled.add(stage);errors.push(stage);console.error("WhatsApp attendance queue stage failed",{stage});
   }
  }
  if(!progress)break;
 }
 return {counts,errors};
}
