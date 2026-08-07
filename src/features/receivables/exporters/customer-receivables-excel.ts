import * as XLSX from "xlsx";
import { translateStoredValue } from "@/lib/hebrew";
import type { ReceivableEvent } from "../types";

const MONEY_FORMAT = '[$₪-he-IL]#,##0.00';
export function exportCustomerWorkbook(events: ReceivableEvent[], today: string) {
  const rows = [["תאריך", "לקוח", "טלפון", "אולם", "סוג אירוע", "סה״כ", "שולם", "יתרה"], ...events.sort((a, b) => a.eventDate.localeCompare(b.eventDate)).map((event) => [excelDate(event.eventDate), event.clientName, event.clientPhone, event.venueName, translateStoredValue(event.eventType), event.totalBilled, event.paid, event.outstanding])];
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: "dd/mm/yyyy" }); sheet["!views"] = [{ RTL: true }]; sheet["!autofilter"] = { ref: `A1:H${events.length + 1}` }; sheet["!cols"] = [{ wch: 14 }, { wch: 24 }, { wch: 16 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  for (let row = 2; row <= events.length + 1; row += 1) { const phone = sheet[`C${row}`]; if (phone) { phone.t = "s"; phone.v = String(phone.v ?? ""); } ["F", "G", "H"].forEach((column) => { const cell = sheet[`${column}${row}`]; if (cell) cell.z = MONEY_FORMAT; }); }
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, "יתרות לקוחות"); XLSX.writeFile(workbook, `יתרות_לקוחות_${today}.xlsx`, { cellDates: true });
}
function excelDate(value: string) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
