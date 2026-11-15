import "server-only";
import type { WhatsAppTemplatePayload } from "./types";

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
export async function sendAttendanceReceipt(phone: string, text: string, useTemplate: boolean): Promise<string> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID, version = process.env.WHATSAPP_API_VERSION;
  if (!token || !phoneId || !version) throw new Error("WhatsApp provider configuration is incomplete");
  const template = process.env.WHATSAPP_TEMPLATE_ATTENDANCE_RECEIPT;
  if (useTemplate && !template) throw new Error("Approved receipt template required");
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: phone, ...(useTemplate ? { type: "template", template: { name: template, language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE_CODE || "he" } } } : { type: "text", text: { body: text, preview_url: false } }) }),
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json().catch(() => null) as MetaWhatsAppResponse | null;
  if (!response.ok || !body?.messages?.[0]?.id) throw new Error("Meta receipt not accepted");
  return body.messages[0].id;
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

  console.log("WhatsApp template send:", {
    templateName: payload.templateName,
    language,
    destinationPhone: payload.phone,
    parameterCount: payload.parameters.length,
  });

  console.log("Phone Number ID:", phoneId);

  console.log(
    "WhatsApp Request:",
    JSON.stringify(requestBody, null, 2)
  );

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

  console.log(
    "WhatsApp Response:",
    JSON.stringify(
      {
        status: response.status,
        ok: response.ok,
        body,
      },
      null,
      2
    )
  );

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
