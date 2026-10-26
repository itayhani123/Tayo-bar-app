import { hydrateSettlementHistory } from "@/features/receivables/utils/settlement-history";
import { createHash } from "node:crypto";
import { z } from "zod";
import { assertOwner } from "@/lib/auth/user";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIsraelDateOnly } from "@/features/dashboard/utils/dashboard-date-range";
import { calculateReceivableEvent, type RawReceivableEvent } from "@/features/receivables/utils/receivables-calculations";
import { calculateVenueClosing, validateCutoff, type VenueSettlement } from "@/features/receivables/utils/venue-settlements";

const inputSchema = z.object({
  action: z.enum(["preview", "confirm"]),
  venueId: z.uuid(),
  cutoffDate: z.string(),
  includesHallFee: z.boolean().default(true),
  version: z.string().optional(),
  requestId: z.uuid().optional(),
}).strict();

export async function GET() {
  try { await assertOwner(); } catch { return Response.json({ error: "Unauthorized" }, { status: 403 }); }
  const db = await createClient();
  const records: VenueSettlement[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from("venue_settlements")
      .select("id, venueId:venue_id, cutoffDate:cutoff_date, amount, createdBy:created_by, createdAt:created_at, includesHallFee:includes_hall_fee, allocations, source_snapshot, venue:venues(name)")
      .order("created_at").order("id").range(offset, offset + 499);
    if (error) return Response.json({ error: "לא ניתן לטעון סגירות אולמות" }, { status: 500 });
    records.push(...data.map(({ venue, source_snapshot, ...row }) => ({ ...row, sourceEvents: source_snapshot?.events, venueName: (venue as unknown as { name: string } | null)?.name, amount: Number(row.amount) })));
    if (data.length < 500) break;
  }
  return Response.json(hydrateSettlementHistory(records).map((row) => ({ ...row, sourceEvents: undefined })), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  let owner;
  try { owner = await assertOwner(); } catch { return Response.json({ error: "Unauthorized" }, { status: 403 }); }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "בקשה לא תקינה" }, { status: 400 });
  const input = parsed.data;
  if (input.action === "confirm" && (!input.version || !input.requestId))
    return Response.json({ error: "יש להציג תצוגה מקדימה לפני אישור" }, { status: 400 });
  try {
    const db = createAdminClient();
    // A lost HTTP response can be retried with the same key without closing again.
    if (input.action === "confirm") {
      const { data, error } = await db.from("venue_settlements").select("id, venue_id, cutoff_date, created_by, includes_hall_fee").eq("request_id", input.requestId!).maybeSingle();
      if (error) throw error;
      if (data) {
        if (data.venue_id !== input.venueId || data.cutoff_date !== input.cutoffDate || data.created_by !== owner.user.id || data.includes_hall_fee !== input.includesHallFee)
          return Response.json({ error: "מזהה הבקשה כבר בשימוש" }, { status: 409 });
        return Response.json({ id: data.id });
      }
    }
    const { data, error } = await db.rpc("venue_settlement_snapshot", { p_venue_id: input.venueId });
    if (error) throw error;
    const snapshot = data as { venue: { id: string; name: string } | null; events: RawReceivableEvent[]; settlements: VenueSettlement[] };
    if (!snapshot.venue) return Response.json({ error: "האולם לא נמצא" }, { status: 404 });
    try { validateCutoff(input.cutoffDate, getIsraelDateOnly(), snapshot.settlements); }
    catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
    const calculation = calculateVenueClosing(snapshot.events.map(calculateReceivableEvent), hydrateSettlementHistory(snapshot.settlements), input.venueId, input.cutoffDate, input.includesHallFee);
    const version = createHash("sha256").update(JSON.stringify({ snapshot, cutoff: input.cutoffDate, includesHallFee: input.includesHallFee })).digest("hex");
    if (input.action === "preview") return Response.json({ ...calculation, venueName: snapshot.venue.name, version });
    if (version !== input.version) return Response.json({ error: "הנתונים השתנו. יש להציג תצוגה מקדימה חדשה ולאשר שוב" }, { status: 409 });
    if (!calculation.amount) return Response.json({ error: "היתרה כבר מאופסת" }, { status: 409 });
    const result = await db.rpc("close_venue_settlement", {
      p_venue_id: input.venueId, p_cutoff_date: input.cutoffDate,
      p_amount: calculation.amount, p_created_by: owner.user.id,
      p_request_id: input.requestId, p_snapshot: snapshot,
      p_includes_hall_fee: input.includesHallFee, p_allocations: calculation.allocations,
    });
    if (result.error) {
      if (["40001", "22023"].includes(result.error.code)) return Response.json({ error: "הנתונים השתנו. יש לרענן את התצוגה המקדימה" }, { status: 409 });
      throw result.error;
    }
    return Response.json({ id: result.data });
  } catch {
    return Response.json({ error: "לא ניתן לבצע סגירה. יש לבדוק את הגדרת השרת והמיגרציה ולנסות שוב" }, { status: 500 });
  }
}
