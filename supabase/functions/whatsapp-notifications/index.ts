import "@supabase/functions-js/edge-runtime.d.ts";

export default {
  async fetch(req: Request) {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const appUrl = Deno.env.get("APP_URL");

    if (!cronSecret || !appUrl) {
      return Response.json(
        { error: "Missing Edge Function configuration" },
        { status: 500 }
      );
    }

    try {
      const response = await fetch(
        `${appUrl}/api/cron/whatsapp-notifications`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cronSecret}`,
            "Content-Type": "application/json",
          },
        }
      );

      const body = await response.text();

      return new Response(body, {
        status: response.status,
        headers: {
          "Content-Type":
            response.headers.get("content-type") ?? "application/json",
        },
      });
    } catch (error) {
      console.error("WhatsApp cron proxy failed:", error);

      return Response.json(
        { error: "Failed to invoke TAYO WhatsApp processor" },
        { status: 500 }
      );
    }
  },
};