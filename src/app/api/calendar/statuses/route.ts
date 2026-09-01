import { requireCurrentUser } from "@/lib/auth/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateVat } from "@/lib/finance/calculations";
import { calculateVenueHallFee } from "@/features/receivables/utils/receivables-calculations";

type EventRow = {
  id: string;
  venue_id: string;
  payer_type: "client" | "venue";
  event_type: string;
  package_type: string;
  guest_count: number | null;
  price_per_guest: number | string;
  vat_rate: number | string;
  price_includes_vat: boolean;
};

type PaymentRow = {
  event_id: string;
  amount: number | string;
};

type VenueRow = {
  id: string;
  name: string;
};

export async function GET() {
  try {
    const { role } = await requireCurrentUser();
    const admin = createAdminClient();

    const [
      eventsResult,
      paymentsResult,
      venuesResult,
    ] = await Promise.all([
      admin
        .from("events")
        .select(
          "id, venue_id, payer_type, event_type, package_type, guest_count, price_per_guest, vat_rate, price_includes_vat"
        ),

      admin
        .from("event_payments")
        .select("event_id, amount"),

      admin
        .from("venues")
        .select("id, name"),
    ]);

    if (eventsResult.error) {
      throw eventsResult.error;
    }

    if (paymentsResult.error) {
      throw paymentsResult.error;
    }

    if (venuesResult.error) {
      throw venuesResult.error;
    }

    const venues = new Map(
      ((venuesResult.data ?? []) as VenueRow[]).map(
        (venue) => [
          venue.id,
          venue.name,
        ]
      )
    );

    const paid = new Map<string, number>();

    for (
      const payment of
      (paymentsResult.data ?? []) as PaymentRow[]
    ) {
      paid.set(
        payment.event_id,
        (paid.get(payment.event_id) ?? 0) +
          Number(payment.amount)
      );
    }

    const statuses = (
      (eventsResult.data ?? []) as EventRow[]
    ).map((event) => {
      const guestCount =
        event.guest_count ?? 0;

      const grossTotal = calculateVat({
        guestCount,
        pricePerGuest: Number(
          event.price_per_guest
        ),
        vatRate: Number(event.vat_rate),
        priceIncludesVat:
          event.price_includes_vat,
      }).grossRevenue;

      const hallFee =
        event.payer_type === "venue"
          ? calculateVenueHallFee({
              venueName:
                venues.get(
                  event.venue_id
                ) ?? "",
              eventType:
                event.event_type,
              packageType:
                event.package_type,
              guestCount,
            })
          : 0;

      const outstandingBalance =
        Math.max(
          0,
          Math.round(
            (
              grossTotal -
              (paid.get(event.id) ?? 0) -
              hallFee +
              Number.EPSILON
            ) * 100
          ) / 100
        );

      return {
        eventId: event.id,
        hasOutstandingBalance:
          outstandingBalance > 0,

        ...(role === "owner"
          ? { outstandingBalance }
          : {}),
      };
    });

    return Response.json({
      statuses,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Calendar statuses failed",
      },
      {
        status: 400,
      }
    );
  }
}