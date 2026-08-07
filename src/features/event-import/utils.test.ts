import assert from "node:assert/strict";
import test from "node:test";
import { inferEventTypeFromName, parseGuestCount, parseIsraeliPhone, parseWorkbookArrayRow, workbookRows } from "./utils";

test("maps the fixed Worksheet columns by zero-based index", () => {
  const parsed = parseWorkbookArrayRow([
    "החתונה של נירית אסרף ושגיא קלאף",
    "26/07/2026",
    200,
    "נירית אשרף",
    "0542349973",
    "שגיא קלאף",
    "0558850732",
    "16/02/2026 17:00",
    1,
  ]);
  assert.equal(parsed.guestCount, 200);
  assert.equal(parsed.clientName, "נירית אשרף");
  assert.equal(parsed.clientPhone, "0542349973");
  assert.equal(parsed.secondaryContactName, "שגיא קלאף");
  assert.equal(parsed.secondaryContactPhone, "0558850732");
  assert.equal(Object.values(parsed).includes(1), false, "the unnamed weekday column is ignored");
});

test("strict guest parser rejects empty and malformed values", () => { assert.equal(parseGuestCount(null), null); assert.equal(parseGuestCount("20 guests"), null); assert.equal(parseGuestCount(" 1,250 "), 1250); });
test("numeric Israeli phones regain a missing leading zero", () => assert.equal(parseIsraeliPhone(542349973), "0542349973"));
test("infers every event type independently from normalized Hebrew names", () => {
  assert.equal(inferEventTypeFromName("החתונה של נירית ושגיא"), "Wedding");
  assert.equal(inferEventTypeFromName("בת מצווה לנועה"), "Bat Mitzvah");
  assert.equal(inferEventTypeFromName("בר מצווה ליואב"), "Bar Mitzvah");
  assert.equal(inferEventTypeFromName("הכנסת ספר תורה"), "Other");
  assert.equal(inferEventTypeFromName("אירוע משפחתי"), "Other");
});
test("Excel import defaults preserve the entered VAT-inclusive price", () => { const workbook = { SheetNames: ["Worksheet"], Sheets: { Worksheet: {} } }; const rows = workbookRows(workbook as never, (() => [["שם האירוע"], ["חתונה", "26/07/2026", "300", "לקוח"]]) as never, { venues: [{ id: "venue-1", name: "קסנאדו" }], packages: ["Pouring"], eventTypes: ["Wedding", "Other"] }); assert.equal(rows[0].pricePerGuest, 15); assert.equal(rows[0].priceIncludesVat, true); });
