import { requireCurrentUser } from "@/lib/auth/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const schema = z.object({
  salesStatus: z.enum(["lead", "contacted", "proposal_sent", "waiting", "won", "lost"]),
  leadSource: z.string().max(500).optional(), salesNotes: z.string().max(5000).optional(),
  lastContactAt: z.string().optional(), nextFollowUpAt: z.string().optional(), proposalAmount: z.number().min(0).optional(),
});

export async function PATCH(request: Request, context: RouteContext<"/api/events/[id]/sales">) {
  try {
    const { role } = await requireCurrentUser();
    const { id } = await context.params;
    const values = schema.parse(await request.json());
    if (role !== "owner" && values.proposalAmount !== undefined) return Response.json({ error: "Unauthorized financial field" }, { status: 403 });
    const admin = createAdminClient();
    const { data: current, error: currentError } = await admin.from("events").select("closed_at").eq("id", id).single();
    if (currentError) throw currentError;
    const update = { sales_status: values.salesStatus, lead_source: values.leadSource?.trim() || null, sales_notes: values.salesNotes?.trim() || null, last_contact_at: values.lastContactAt || null, next_follow_up_at: values.nextFollowUpAt || null, ...(role === "owner" && values.proposalAmount !== undefined ? { proposal_amount: values.proposalAmount } : {}), ...(values.salesStatus === "won" && !current.closed_at ? { closed_at: new Date().toISOString() } : {}) };
    const { data, error } = await admin.from("events").update(update).eq("id", id).select().single();
    if (error) throw error;
    return Response.json({ event: data });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Sales update failed" }, { status: 400 }); }
}
