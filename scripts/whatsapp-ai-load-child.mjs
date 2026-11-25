// Synthetic model/provider process for LOCAL benchmark only. No network/secrets.
import {setTimeout as sleep} from 'node:timers/promises';
import {processWhatsAppAi} from '../src/lib/whatsapp/ai-worker.ts';
let sequence=0,stop=false,mode='slow';const pending=new Map();
process.on('message',message=>{
 if(message.type==='result'){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p.reject(Error(message.error));else p.resolve({data:message.data,error:null});}
 if(message.type==='stop')stop=true;
 if(message.type==='start'){mode=message.mode;void run(message.phoneId);}
});
const db={rpc(name,args){const id=++sequence;const p=new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));process.send({type:'rpc',id,name,args});return Object.assign(p,{abortSignal:()=>p});}};
async function run(phoneId){
 try{
  while(!stop){
   await processWhatsAppAi(db,new AbortController().signal,phoneId,async()=>{await sleep(5);return 'benchmark-'+crypto.randomUUID();},async()=>{
    process.send({type:'model-started'});try{await sleep(5000);if(mode==='failed')throw Error('synthetic model failure');return 'Synthetic benchmark response';}finally{process.send({type:'model-finished'});}
   });
   await sleep(50);
  }
  process.disconnect();
 }catch{process.send({type:'child-error'});process.disconnect();process.exitCode=1;}
}
