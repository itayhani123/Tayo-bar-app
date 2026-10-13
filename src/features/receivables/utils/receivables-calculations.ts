import { calculatePaymentSummary } from "@/features/event-payments/calculations";
import { calculateVat, roundMoney } from "@/lib/finance/calculations";
import type { ReceivableEvent } from "../types";
import { receivablePaymentStatus } from "./receivables-policy";

export const XANADU_VENUE_NAME = "קסנאדו";
export const UPTOWN_VENUE_NAME = "אפטאון";

export const VENUE_HALL_FEE_PER_GUEST: Readonly<Record<string, number>> = {
  [XANADU_VENUE_NAME]: 3,
  [UPTOWN_VENUE_NAME]: 7,
};

export const HALL_FEE_PACKAGE_TYPES = new Set([
  "Premium",
  "Super Premium",
  "Ultra Premium",
]);

export type RawReceivableEvent = {
  id: string;
  eventDate: string;
  eventType: string;
  venueId: string;
  venueName: string;
  clientName: string;
  clientPhone: string;
  payerType: "client" | "venue";
  guestCount: number;
  packageType: string;
  pricePerGuest: number;
  vatRate: number;
  priceIncludesVat: boolean;
  notes: string;
  payments: {
    amount: number;
    paidAt: string;
    paymentMethod: string;
  }[];
};

export type VenueHallFeeCalculation = {
  feePerGuest: number;
  chargedGuestCount: number;
  fee: number;
};

export function getVenueHallFeePerGuest(
  venueName: string
): number {
  return (
    VENUE_HALL_FEE_PER_GUEST[
      venueName.trim()
    ] ?? 0
  );
}

function normalizeValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function isWedding(
  eventType: string | null | undefined
): boolean {
  const value = normalizeValue(eventType);

  return (
    value === "wedding" ||
    value === "חתונה"
  );
}

function hasQualifyingAlcoholPackage(
  packageType: string | null | undefined
): boolean {
  const value = normalizeValue(packageType);

  return [...HALL_FEE_PACKAGE_TYPES].some(
    (packageName) =>
      packageName.toLowerCase() === value
  );
}

/**
 * מחזיר את מספר האורחים שעליהם מחושבת עמלת האולם.
 *
 * קסנאדו:
 * - תפריט אלכוהול מזכה -> כל האורחים.
 * - אחרת -> 0.
 *
 * אפטאון:
 * - חתונה -> כל האורחים.
 * - תפריט אלכוהול מזכה -> כל האורחים.
 * - אירוע אחר מעל 100 אורחים -> רק האורחים שמעל 100.
 * - אירוע אחר עד 100 אורחים -> 0.
 */
export function calculateVenueHallFeeGuestCount(event: {
  venueName: string;
  eventType: string;
  packageType: string;
  guestCount: number | null | undefined;
}): number {
  const venueName = event.venueName.trim();

  const guestCount = Math.max(
    event.guestCount ?? 0,
    0
  );

  if (guestCount <= 0) {
    return 0;
  }

  const qualifyingPackage =
    hasQualifyingAlcoholPackage(
      event.packageType
    );

  /*
   * קסנאדו
   */
  if (venueName === XANADU_VENUE_NAME) {
    return qualifyingPackage
      ? guestCount
      : 0;
  }

  /*
   * אפטאון
   */
  if (venueName === UPTOWN_VENUE_NAME) {
    if (
      isWedding(event.eventType) ||
      qualifyingPackage
    ) {
      return guestCount;
    }

    /*
     * אירוע אחר:
     * עמלה רק על האורחים שמעל 100.
     *
     * 120 אורחים -> 20 לחיוב.
     */
    return Math.max(
      guestCount - 100,
      0
    );
  }

  return 0;
}

/**
 * חישוב מלא של עמלת האולם.
 */
export function calculateVenueHallFeeDetails(event: {
  venueName: string;
  eventType: string;
  packageType: string;
  guestCount: number | null | undefined;
}): VenueHallFeeCalculation {
  const feePerGuest =
    getVenueHallFeePerGuest(
      event.venueName
    );

  if (feePerGuest <= 0) {
    return {
      feePerGuest: 0,
      chargedGuestCount: 0,
      fee: 0,
    };
  }

  const chargedGuestCount =
    calculateVenueHallFeeGuestCount(
      event
    );

  return {
    feePerGuest,
    chargedGuestCount,
    fee: roundMoney(
      chargedGuestCount *
        feePerGuest
    ),
  };
}

/**
 * נשמר גם helper שמחזיר רק את סכום העמלה,
 * כדי לא לשבור קוד אחר שכבר משתמש בפונקציה.
 */
export function calculateVenueHallFee(event: {
  venueName: string;
  eventType: string;
  packageType: string;
  guestCount: number | null | undefined;
}): number {
  return calculateVenueHallFeeDetails(
    event
  ).fee;
}

export function calculateReceivableEvent(
  event: RawReceivableEvent
): ReceivableEvent {
  const finance = calculateVat({
    guestCount:
      event.guestCount ?? 0,
    pricePerGuest:
      event.pricePerGuest,
    vatRate: event.vatRate,
    priceIncludesVat:
      event.priceIncludesVat,
  });

  const payment =
    calculatePaymentSummary(
      finance.grossRevenue,
      event.payments
    );

  const hallFee =
    calculateVenueHallFeeDetails(
      event
    );

  const venueHallFeePerGuest =
    hallFee.feePerGuest;

  const venueHallFeeGuestCount =
    hallFee.chargedGuestCount;

  const venueHallFee =
    hallFee.fee;

  const outstandingBeforeHallFee =
    payment.remainingBalance;

  /*
   * אם הלקוח משלם:
   * עמלת האולם לא מקטינה את החוב שלו.
   *
   * אם האולם משלם:
   * העמלה מתקזזת מהיתרה שהאולם חייב לטאיו.
   */
  const outstanding =
    event.payerType === "client"
      ? outstandingBeforeHallFee
      : roundMoney(
          outstandingBeforeHallFee -
            venueHallFee
        );

  /*
   * בסיס ההתחשבנות מול האולם.
   *
   * אם האולם הוא המשלם:
   * מתחילים מהיתרה שהאולם חייב.
   *
   * אם הלקוח הוא המשלם:
   * אין חוב בסיס של האולם לטאיו.
   */
  const venueSettlementBeforeHallFee =
    event.payerType === "venue"
      ? outstandingBeforeHallFee
      : 0;

  /*
   * עמלת האולם תמיד משתתפת בהתחשבנות
   * מול האולם, ללא קשר לזהות המשלם.
   */
  const venueSettlement =
    roundMoney(
      venueSettlementBeforeHallFee -
        venueHallFee
    );

  const totalBilled =
    event.payerType === "client"
      ? payment.totalDue
      : roundMoney(
          payment.totalDue -
            venueHallFee
        );

  const lastPayment = [
    ...event.payments,
  ].sort((a, b) =>
    b.paidAt.localeCompare(a.paidAt)
  )[0];

  return {
    id: event.id,
    eventDate: event.eventDate,
    eventType: event.eventType,
    venueId: event.venueId,
    venueName: event.venueName,
    clientName: event.clientName,
    clientPhone: event.clientPhone,

    guestCount:
      event.guestCount ?? 0,

    packageType:
      event.packageType,

    pricePerGuest:
      event.pricePerGuest,

    notes: event.notes,
    payerType: event.payerType,

    totalBilled,
    paid: payment.totalPaid,

    outstandingBeforeHallFee,

    venueHallFeePerGuest,
    venueHallFeeGuestCount,
    venueHallFee,

    outstanding,

    venueSettlementBeforeHallFee,
    venueSettlement,

    paymentStatus:
      receivablePaymentStatus(
        outstanding,
        payment.totalPaid
      ),

    lastPaymentDate:
      lastPayment?.paidAt ?? null,

    lastPaymentMethod:
      lastPayment?.paymentMethod ??
      null,
  };
}
