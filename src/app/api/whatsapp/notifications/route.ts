import { assertOwner } from "@/lib/auth/user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    await assertOwner();
    const admin = createAdminClient();
    const { data, error } = await admin.from("whatsapp_notifications").select("id, employee_id, event_id, notification_type, scheduled_for, sent_at, status, error_message, employees(full_name), events(client_name)").order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return Response.json(data);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unauthorized" }, { status: 403 }); }
}

export async function POST(request: Request) {
  try {
    await assertOwner();
    const { id } = await request.json() as { id?: string };
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
    const { error } = await createAdminClient().from("whatsapp_notifications").update({ status: "pending", scheduled_for: new Date().toISOString(), error_message: null }).eq("id", id).eq("status", "failed");
    if (error) throw error;
    return Response.json({ retried: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unauthorized" }, { status: 403 }); }
}
