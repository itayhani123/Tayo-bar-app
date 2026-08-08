import "server-only";
import type { WhatsAppTemplatePayload } from "./types";

export async function sendWhatsAppTemplate(payload: WhatsAppTemplatePayload): Promise<string> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION;
  const language = "he";
  if (!token || !phoneId || !version) throw new Error("WhatsApp provider configuration is incomplete");
  if (process.env.NODE_ENV === "development") console.info("WhatsApp template send:", { templateName: payload.templateName, language, destinationPhone: payload.phone, parameterCount: payload.parameters.length });
  const template = {
    name: payload.templateName,
    language: { code: language },
    ...(payload.parameters.length > 0 ? { components: [{ type: "body", parameters: payload.parameters.map((text) => ({ type: "text", text })) }] } : {}),
  };
  console.log("Phone Number ID:", phoneId);

console.log(
  "WhatsApp Request:",
  JSON.stringify(
    {
      messaging_product: "whatsapp",
      to: payload.phone,
      type: "template",
      template,
    },
    null,
    2
  )
);
  const response = await fetch(
  `https://graph.facebook.com/${version}/${phoneId}/messages`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: payload.phone,
      type: "template",
      template,
    }),
    signal: AbortSignal.timeout(15_000),
  }
);
  const body = await response.json().catch(() => null) as { messages?: { id: string }[]; error?: { message?: string } } | null;
  if (!response.ok || !body?.messages?.[0]?.id) throw new Error(body?.error?.message ?? `WhatsApp provider returned ${response.status}`);
  return body.messages[0].id;
}
