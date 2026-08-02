import { z } from "zod";
import { PAYER_TYPES, PAYMENT_STATUSES } from "./types";

export const eventSchema = z.object({
  eventDate: z.string().min(1, "Date is required."),
  startTime: z.string().min(1, "Time is required."),
  venueId: z.string().uuid("Venue is required."),
  clientName: z.string().trim().min(1, "Client name is required.").max(160),
  clientPhone: z.string().trim().max(40),
  guestCount: z.number().int().positive("Guest count must be at least 1."),
  eventType: z.string().min(1, "Event type is required."),
  packageType: z.string().min(1, "Package is required."),
  pricePerGuest: z.number().min(0, "Price per guest cannot be negative."),
  payerType: z.enum(PAYER_TYPES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  estimatedAlcoholCost: z.number().min(0, "Alcohol cost cannot be negative."),
  securityCheckReceived: z.boolean(),
  invoiceIssued: z.boolean(),
  managerEmployeeId: z.string().uuid("Manager ID must be a valid UUID.").or(z.literal("")),
  notes: z.string().max(5000),
});
