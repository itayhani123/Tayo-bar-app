import type {AttendanceReplyButton} from "./attendance-messages";
type Configuration={token:string;phoneId:string;version:string;template?:string;language:string;replyButtons:boolean};
export async function deliverAttendanceMessage(config:Configuration,phone:string,text:string,useTemplate:boolean,buttons?:AttendanceReplyButton[],fetcher:typeof fetch=fetch):Promise<string>{
 if(useTemplate&&!config.template)throw new Error("APPROVED_TEMPLATE_REQUIRED");
 if(!useTemplate&&text.length>4096)throw new Error("MESSAGE_TOO_LONG");
 const interactive=!useTemplate&&config.replyButtons&&Boolean(buttons?.length);
 if(interactive&&(text.length>1024||buttons!.length>3||buttons!.some(b=>b.id.length>256||b.title.length>20)))throw new Error("INTERACTIVE_MESSAGE_TOO_LONG");
 const send=(withButtons:boolean)=>fetcher(`https://graph.facebook.com/${config.version}/${config.phoneId}/messages`,{
  method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json"},
  body:JSON.stringify({messaging_product:"whatsapp",to:phone,...(useTemplate?{type:"template",template:{name:config.template,language:{code:config.language}}}:withButtons?{type:"interactive",interactive:{type:"button",body:{text},action:{buttons:buttons!.map(reply=>({type:"reply",reply}))}}}:{type:"text",text:{body:text,preview_url:false}})}),signal:AbortSignal.timeout(10000),
 });
 try{
  let response=await send(interactive);let body=await response.json().catch(()=>null);
  if(interactive&&response.status===400&&[100,131009,131051].includes(body?.error?.code)){response=await send(false);body=await response.json().catch(()=>null);}
  if(!response.ok||typeof body?.messages?.[0]?.id!=="string")throw new Error("META_MESSAGE_NOT_ACCEPTED");
  return body.messages[0].id;
 }catch{throw new Error("META_DELIVERY_NOT_VERIFIED");}
}
