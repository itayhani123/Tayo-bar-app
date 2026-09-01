import type { EventInput } from "@fullcalendar/core";
import { translateStoredValue } from "@/lib/hebrew";
import type { CalendarEvent } from "../types";

export const recommendedBartenders = (guests: number) => Math.ceil(Math.max(guests, 0) / 70) + 1;
export const isBritEvent = (eventType: string) => eventType.trim().toLocaleLowerCase() === "brit" || eventType.trim() === "ברית";
export const isNotPouringFee = (packageType: string) => packageType !== "Pouring";

export function readableTextColor(color: string): "#FFFFFF" | "#111827" {
  if (!/^#[0-9A-F]{6}$/i.test(color)) return "#FFFFFF";
  const [red, green, blue] = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 150 ? "#111827" : "#FFFFFF";
}

export function toFullCalendarEvent(event: CalendarEvent, color = "#475569"): EventInput {
  const closed = event.salesStatus === "won";
  const notPouringFee = isNotPouringFee(event.packageType);
  const cardColor = notPouringFee ? "#fef08a" : closed ? "#15803d" : color;
  const classNames = [
    ...(closed ? ["calendar-sale-won"] : []),
    ...(isBritEvent(event.eventType) ? ["calendar-event-brit"] : []),
    ...(notPouringFee ? ["calendar-not-pouring-fee"] : []),
  ];
  return {
    id: event.id,
    title: `${event.venueName} · ${translateStoredValue(event.eventType)} · ${event.guestCount} אורחים`,
    start: `${event.eventDate}T${event.startTime}`,
    allDay: false,
    editable: true,
    durationEditable: false,
    backgroundColor: cardColor,
    borderColor: closed ? "#166534" : notPouringFee ? "#eab308" : color,
    textColor: readableTextColor(cardColor),
    classNames,
    extendedProps: { record: event },
  };
}
