import type {AttendanceReplyButton} from "./attendance-messages";
type Configuration={token:string;phoneId:string;version:string;template?:string;language:string;replyButtons:boolean};
export class AttendanceDeliveryError extends Error {
 constructor(public readonly code:string,public readonly retryable:boolean,public readonly httpStatus?:number,public readonly metaCode?:number){super(code);}
}
export async function deliverAttendanceMessage(config:Configuration,phone:string,text:string,useTemplate:boolean,buttons?:AttendanceReplyButton[],fetcher:typeof fetch=fetch):Promise<string>{
 if(useTemplate&&!config.template)throw new Error("APPROVED_TEMPLATE_REQUIRED");
 if(!useTemplate&&text.length>4096)throw new Error("MESSAGE_TOO_LONG");
 const interactive=!useTemplate&&config.replyButtons&&Boolean(buttons?.length);
 if(buttons?.length&&!interactive)throw new AttendanceDeliveryError("INTERACTIVE_REQUIRED",false);
 if(interactive&&(text.length>1024||buttons!.length>3||buttons!.some(b=>b.id.length>256||b.title.length>20)))throw new Error("INTERACTIVE_MESSAGE_TOO_LONG");
 const send=(withButtons:boolean)=>fetcher(`https://graph.facebook.com/${config.version}/${config.phoneId}/messages`,{
  method:"POST",headers:{Authorization:`Bearer ${config.token}`,"Content-Type":"application/json"},
  body:JSON.stringify({messaging_product:"whatsapp",to:phone,...(useTemplate?{type:"template",template:{name:config.template,language:{code:config.language}}}:withButtons?{type:"interactive",interactive:{type:"button",body:{text},action:{buttons:buttons!.map(reply=>({type:"reply",reply}))}}}:{type:"text",text:{body:text,preview_url:false}})}),signal:AbortSignal.timeout(10000),
 });
 try{
  const response=await send(interactive);const body=await response.json().catch(()=>null);
  if(!response.ok||typeof body?.messages?.[0]?.id!=="string")throw new AttendanceDeliveryError(interactive?"META_BUTTONS_NOT_ACCEPTED":"META_MESSAGE_NOT_ACCEPTED",response.status>=500||response.status===429||response.ok,response.status,Number.isSafeInteger(body?.error?.code)?body.error.code:undefined);
  return body.messages[0].id;
 }catch(error){if(error instanceof AttendanceDeliveryError)throw error;throw new AttendanceDeliveryError("META_DELIVERY_NOT_VERIFIED",true);}
}
