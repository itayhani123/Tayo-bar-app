import "server-only";
import type { WhatsAppTemplatePayload } from "./types";
import type { AttendanceReplyButton } from "./attendance-messages";
import { deliverAttendanceMessage } from "./attendance-delivery";

type MetaWhatsAppError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
  error_data?: {
    messaging_product?: string;
    details?: string;
  };
};

type MetaWhatsAppResponse = {
  messages?: { id: string }[];
  error?: MetaWhatsAppError;
};

/** Same Meta connection; no contact details or message bodies are logged. */
export async function sendAttendanceReceipt(phone:string,text:string,useTemplate:boolean,buttons?:AttendanceReplyButton[],kind="result"):Promise<string>{
 const token=process.env.WHATSAPP_ACCESS_TOKEN,phoneId=process.env.WHATSAPP_PHONE_NUMBER_ID,version=process.env.WHATSAPP_API_VERSION;
 if(!token||!phoneId||!version)throw new Error("WhatsApp provider configuration is incomplete");
 return deliverAttendanceMessage({token,phoneId,version,template:kind==="result"?process.env.WHATSAPP_TEMPLATE_ATTENDANCE_RECEIPT:process.env.WHATSAPP_TEMPLATE_ATTENDANCE_UPDATE,language:process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE||"he",replyButtons:true},phone,text,useTemplate,buttons);
}
export async function sendWhatsAppTemplate(
  payload: WhatsAppTemplatePayload
): Promise<string> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION;
  const language = "he";

  if (!token || !phoneId || !version) {
    throw new Error("WhatsApp provider configuration is incomplete");
  }

  const template = {
    name: payload.templateName,
    language: {
      code: language,
    },
    ...(payload.parameters.length > 0
      ? {
          components: [
            {
              type: "body",
              parameters: payload.parameters.map((text) => ({
                type: "text",
                text,
              })),
            },
          ],
        }
      : {}),
  };

  const requestBody = {
    messaging_product: "whatsapp",
    to: payload.phone,
    type: "template",
    template,
  };

  console.info("WhatsApp template send", { parameterCount: payload.parameters.length });
  const response = await fetch(
    `https://graph.facebook.com/${version}/${phoneId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(15_000),
    }
  );

  const body = (await response
    .json()
    .catch(() => null)) as MetaWhatsAppResponse | null;

  if (!response.ok || !body?.messages?.[0]?.id) {
    const error = body?.error;

    const details =
      error?.error_data?.details ??
      error?.message ??
      `WhatsApp provider returned ${response.status}`;

    throw new Error(details);
  }

  return body.messages[0].id;
}
