import { requireCurrentUser } from "@/lib/auth/user";
import { cancelAssignmentNotifications, enqueueAssignmentNotifications, enqueueEventChanged } from "@/lib/whatsapp/enqueue";

type TriggerBody = { action?: "assignment_created" | "work_time_updated" | "event_changed" | "assignment_removed"; assignmentId?: string; eventId?: string };

export async function POST(request: Request) {
  try {
    const { role } = await requireCurrentUser();
    const body = await request.json() as TriggerBody;
    if (body.action === "event_changed" && body.eventId) return Response.json(await enqueueEventChanged(body.eventId));
    if (body.action === "assignment_removed" && body.assignmentId) { await cancelAssignmentNotifications(body.assignmentId); return Response.json({ cancelled: true }); }
    if ((body.action === "assignment_created" || body.action === "work_time_updated") && body.assignmentId) return Response.json(await enqueueAssignmentNotifications(body.assignmentId, body.action, role));
    return Response.json({ error: "Invalid notification trigger" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notification enqueue failed";
    return Response.json({ error: message }, { status: 400 });
  }
}
