import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "./action-types";
import { enqueueLeadWelcome, enqueueEventChanged, enqueueAssignmentNotifications, cancelAssignmentNotifications } from "@/lib/whatsapp/enqueue";
import { scheduleChanged } from "@/lib/whatsapp/scheduling";
import type { ActionSnapshot } from "./action-proposals";

/** Existing notification workflows, after the business transaction commits; never retried as a business action. */
export async function afterConfirmedAction(db: SupabaseClient, proposalId: string, actorId: string, role: "owner" | "manager", result: ActionResult) {
  const { data, error } = await db.from("ai_action_proposals").select("action,payload,expected").eq("id", proposalId).eq("actor_id", actorId).single();
  if (error || !data) throw new Error("NOTIFICATION_UNAVAILABLE");
  const expected = data.expected as ActionSnapshot;
  const payload = data.payload as Record<string, unknown>;
  let notification: { queued: number; warning?: string } | undefined;
  if (data.action === "propose_create_event" && result.eventId) notification = await enqueueLeadWelcome(result.eventId);
  if (data.action === "propose_update_event" && result.eventId && expected.event && scheduleChanged(expected.event.event_date, expected.event.start_time, String(payload.event_date ?? expected.event.event_date), String(payload.start_time ?? expected.event.start_time))) notification = await enqueueEventChanged(result.eventId);
  if (data.action === "propose_assign_employee" && result.targetId) notification = await enqueueAssignmentNotifications(result.targetId, "assignment_created", role);
  if (data.action === "propose_update_assignment" && result.targetId && ("work_start" in payload || "work_end" in payload)) notification = await enqueueAssignmentNotifications(result.targetId, "work_time_updated", role);
  if (data.action === "propose_remove_assignment" && result.targetId) await cancelAssignmentNotifications(result.targetId);
  if (notification?.warning) throw new Error("NOTIFICATION_UNAVAILABLE");
}
