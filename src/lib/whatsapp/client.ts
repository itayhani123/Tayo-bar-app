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