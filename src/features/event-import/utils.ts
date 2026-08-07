import type { WorkBook, WorkSheet } from "xlsx";
import type { EventType } from "@/features/events/types";
import type { ImportMasterData, ImportRow } from "./types";

export type WorkbookCell = string | number | boolean | Date | null | undefined;
export type WorkbookArrayRow = WorkbookCell[];
export type ParsedSourceRow = { eventName: string; eventDate: string; guestCount: number | null; clientName: string; clientPhone: string; secondaryContactName: string; secondaryContactPhone: string; sourceCreatedAt: string; usedEventNameFallback: boolean };

const CONTACT_FALLBACK = "חסר איש קשר — נעשה שימוש בשם האירוע";
const EVENT_TYPE_REVIEW = "סוג האירוע הוסק כ׳אחר׳ — נדרשת בדיקה";
const text = (cell: WorkbookCell) => String(cell ?? "").trim();

export function normalizeEventName(value: string): string { return value.trim().toLocaleLowerCase("he-IL").replace(/[.,!?;:()[\]{}"'׳״_-]+/g, " ").replace(/\s+/g, " "); }
export function inferEventTypeFromName(eventName: string): EventType {
  const name = normalizeEventName(eventName);
  if (name.includes("בר/בת מצווה") || name.includes("בת/בר מצווה")) return "Other";
  if (/(^|\s)בת מצווה($|\s)/.test(name)) return "Bat Mitzvah";
  if (/(^|\s)בר מצווה($|\s)/.test(name)) return "Bar Mitzvah";
  if (name.includes("חתונה") || name.includes("החתונה")) return "Wedding";
  if (name.includes("ברית")) return "Brit";
  if (name.includes("חינה")) return "Henna";
  if (name.includes("עסקי") || name.includes("עסקית")) return "Business";
  if (name.includes("הכנסת ספר תורה")) return "Other";
  return "Other";
}
export function eventTypeNeedsReview(eventName: string, inferred = inferEventTypeFromName(eventName)): boolean { const name = normalizeEventName(eventName); return inferred === "Other" && (name.includes("בר/בת מצווה") || name.includes("בת/בר מצווה") || !name.includes("הכנסת ספר תורה")); }
export function parseGuestCount(cell: WorkbookCell): number | null { if (typeof cell === "number") return Number.isInteger(cell) && cell >= 0 ? cell : null; const normalized = text(cell).replace(/[\s,]/g, ""); return /^\d+$/.test(normalized) ? Number(normalized) : null; }
export function parseIsraeliPhone(cell: WorkbookCell): string { const raw = text(cell); if (!raw) return ""; if (!/^\d+(?:\.0+)?$/.test(raw.replace(/[\s-]/g, ""))) return raw; const digits = raw.replace(/\.0+$/, "").replace(/\D/g, ""); return digits.length === 9 ? `0${digits}` : digits; }
function parseDate(cell: WorkbookCell): string { if (cell instanceof Date) return isoDate(cell.getFullYear(), cell.getMonth() + 1, cell.getDate()); const raw = text(cell); const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw); if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1])); const parsed = new Date(raw); return raw && !Number.isNaN(parsed.getTime()) ? isoDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate()) : raw; }
const isoDate = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
export function parseWorkbookArrayRow(row: WorkbookArrayRow): ParsedSourceRow { const eventName = text(row[0]); const suppliedClientName = text(row[3]); return { eventName, eventDate: parseDate(row[1]), guestCount: parseGuestCount(row[2]), clientName: suppliedClientName || eventName, clientPhone: parseIsraeliPhone(row[4]), secondaryContactName: text(row[5]), secondaryContactPhone: parseIsraeliPhone(row[6]), sourceCreatedAt: text(row[7]), usedEventNameFallback: !suppliedClientName && Boolean(eventName) }; }
function notesFor(source: ParsedSourceRow) { const notes: string[] = []; if (source.secondaryContactName) notes.push(`איש קשר נוסף: ${source.secondaryContactName}`); if (source.secondaryContactPhone) notes.push(`טלפון נוסף: ${source.secondaryContactPhone}`); if (source.sourceCreatedAt) notes.push(`נוצר במערכת הישנה: ${source.sourceCreatedAt}`); return notes.join("\n"); }
type SheetToJson = (sheet: WorkSheet, options: { header: 1; raw: false; defval: null }) => WorkbookArrayRow[];

export function workbookRows(workbook: WorkBook, sheetToJson: SheetToJson, master: ImportMasterData): ImportRow[] {
  const sheet = workbook.Sheets.Worksheet ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const xanadu = master.venues.find((venue) => venue.name.trim() === "קסנאדו");
  return sheetToJson(sheet, { header: 1, raw: false, defval: null }).slice(1).filter((row) => row.some((cell) => cell !== null && text(cell) !== "")).map((row, index) => {
    const source = parseWorkbookArrayRow(row);
    const eventType = inferEventTypeFromName(source.eventName);
    const needsReview = eventTypeNeedsReview(source.eventName, eventType);
    const warnings = [source.usedEventNameFallback ? CONTACT_FALLBACK : "", needsReview ? EVENT_TYPE_REVIEW : ""].filter(Boolean);
    return validateImportRow({ rowNumber: index + 2, eventName: source.eventName, eventDate: source.eventDate, startTime: "19:30", venueId: xanadu?.id ?? "", venueName: "קסנאדו", clientName: source.clientName, clientPhone: source.clientPhone, guestCount: source.guestCount, secondaryContactName: source.secondaryContactName, secondaryContactPhone: source.secondaryContactPhone, sourceCreatedAt: source.sourceCreatedAt, eventType, eventTypeNeedsReview: needsReview, packageType: "Pouring", pricePerGuest: 15, vatRate: 18, priceIncludesVat: true, payerType: "client", paymentStatus: "unpaid", estimatedAlcoholCost: 0, securityCheckReceived: false, invoiceIssued: false, managerEmployeeId: "", notes: notesFor(source), errors: warnings }, master);
  });
}

export function validateImportRow(row: ImportRow, master: ImportMasterData): ImportRow { const errors: string[] = row.errors.filter((error) => error === CONTACT_FALLBACK || error === EVENT_TYPE_REVIEW); if (!row.eventDate || Number.isNaN(Date.parse(row.eventDate))) errors.push("תאריך אירוע אינו תקין"); if (!row.clientName.trim()) errors.push("חסר איש קשר"); if (row.guestCount === null || !Number.isInteger(row.guestCount) || row.guestCount < 1) errors.push("חסר מספר אורחים"); if (!master.eventTypes.includes(row.eventType)) errors.push("סוג האירוע אינו קיים במערכת"); if (!master.venues.some((venue) => venue.id === row.venueId)) errors.push(`האולם ${row.venueName || "שנבחר"} אינו קיים במערכת`); if (!master.packages.includes(row.packageType)) errors.push("חבילת הבר שנבחרה אינה קיימת במערכת"); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.startTime)) errors.push("שעת ההתחלה אינה תקינה"); if (!Number.isFinite(row.pricePerGuest) || row.pricePerGuest < 0) errors.push("המחיר לאורח אינו תקין"); return { ...row, errors }; }
export const hasBlockingErrors = (row: ImportRow) => row.errors.some((error) => error !== CONTACT_FALLBACK && error !== EVENT_TYPE_REVIEW);
