import type { EventFormValues } from "./types";

/** Shared by the existing form workflow and server-confirmed AI actions. */
export function buildEventPayload(values: EventFormValues) {
  return {
    event_date: values.eventDate, start_time: values.startTime, event_type: values.eventType, venue_id: values.venueId,
    client_name: values.clientName.trim(), client_phone: values.clientPhone.trim() || null, guest_count: values.guestCount,
    price_per_guest: values.pricePerGuest, vat_rate: values.vatRate, price_includes_vat: values.priceIncludesVat, package_type: values.packageType, payer_type: values.payerType,
    payment_status: values.paymentStatus, manager_employee_id: values.managerEmployeeId || null,
    security_check_received: values.securityCheckReceived, invoice_issued: values.invoiceIssued,
    estimated_alcohol_cost: values.estimatedAlcoholCost, notes: values.notes.trim() || null,
  };
}
