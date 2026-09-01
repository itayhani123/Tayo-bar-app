import * as XLSX from "xlsx";
import { translateStoredValue } from "@/lib/hebrew";
import type { ReceivableEvent } from "../types";
import { venueExportEvents } from "./export-policy";

const MONEY_FORMAT = '[$₪-he-IL]#,##0.00';
const HEADER_ROW = 4;
export const venueExportColumns = ["תאריך", "לקוח", "סוג אירוע", "תפריט", "מספר אורחים", "משלם", "יתרה לפני עמלה", "עמלה לאולם", "יתרה נטו מול האולם"] as const;

export function createVenueWorkbook(venueName: string, sourceEvents: ReceivableEvent[]): XLSX.WorkBook {
  const events = [...sourceEvents].sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  const totalBeforeHallFee = events.reduce((sum, event) => sum + event.venueSettlementBeforeHallFee, 0);
  const totalSettlement = events.reduce((sum, event) => sum + event.venueSettlement, 0);
  const totalHallFee = events.reduce((sum, event) => sum + event.venueHallFee, 0);
  const rows: (string | number | Date)[][] = [
    ["דוח יתרה לגבייה"],
    [`אולם: ${venueName}`],
    [],
    [...venueExportColumns],
    ...events.map((event) => [excelDate(event.eventDate), event.clientName, translateStoredValue(event.eventType), translateStoredValue(event.packageType), event.guestCount, event.payerType === "venue" ? "אולם" : "לקוח", event.venueSettlementBeforeHallFee, -event.venueHallFee, event.venueSettlement]),
    ["סה״כ להתחשבנות", "", "", "", "", "", totalBeforeHallFee, -totalHallFee, totalSettlement],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: "dd/mm/yyyy" });
  sheet["!views"] = [{ RTL: true }];
  sheet["!freeze"] = { xSplit: 0, ySplit: HEADER_ROW, topLeftCell: `A${HEADER_ROW + 1}`, activePane: "bottomLeft", state: "frozen" };
  sheet["!autofilter"] = { ref: `A${HEADER_ROW}:I${HEADER_ROW + events.length}` };
  sheet["!cols"] = [{ wch: 14 }, { wch: 28 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];
  makeBold(sheet.A1); makeBold(sheet.A2);
  for (let column = 0; column < venueExportColumns.length; column += 1) makeBold(sheet[XLSX.utils.encode_cell({ r: HEADER_ROW - 1, c: column })]);
  for (let index = 0; index < events.length; index += 1) { setMoney(sheet[`G${HEADER_ROW + 1 + index}`]); setMoney(sheet[`H${HEADER_ROW + 1 + index}`]); setMoney(sheet[`I${HEADER_ROW + 1 + index}`]); }
  const totalRow = HEADER_ROW + events.length + 1; makeBold(sheet[`A${totalRow}`]); makeBold(sheet[`G${totalRow}`]); makeBold(sheet[`H${totalRow}`]); makeBold(sheet[`I${totalRow}`]); setMoney(sheet[`G${totalRow}`]); setMoney(sheet[`H${totalRow}`]); setMoney(sheet[`I${totalRow}`]);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "יתרה לגבייה"); return workbook;
}

export function exportVenueWorkbook(venueId: string, venueName: string, events: ReceivableEvent[], today: string) {
  const venueEvents = venueExportEvents(events, today, venueId); if (!venueEvents.length) return false;
  XLSX.writeFile(createVenueWorkbook(venueName, venueEvents), `יתרה_לגבייה_${safeFilename(venueName)}_${today}.xlsx`, { cellDates: true, cellStyles: true }); return true;
}
function setMoney(cell: XLSX.CellObject | undefined) { if (cell) cell.z = MONEY_FORMAT; }
function makeBold(cell: XLSX.CellObject | undefined) { if (cell) cell.s = { ...cell.s, font: { ...cell.s?.font, bold: true } }; }
function safeFilename(value: string) { return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "אולם"; }
function excelDate(value: string) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
