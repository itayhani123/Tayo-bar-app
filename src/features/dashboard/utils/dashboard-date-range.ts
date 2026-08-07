export type DashboardActualDateRange = { start: string; end: string };

const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
const datePattern = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function getDashboardActualDateRange(selectedMonth: string, today: string): DashboardActualDateRange | null {
  const monthMatch = monthPattern.exec(selectedMonth);
  const dateMatch = datePattern.exec(today);
  if (!monthMatch || !dateMatch) throw new Error("Invalid dashboard month or date");
  const currentMonth = today.slice(0, 7);
  if (selectedMonth > currentMonth) return null;
  if (selectedMonth === currentMonth) return { start: `${selectedMonth}-01`, end: today };
  const year = Number(monthMatch[1]);
  const month = Number(monthMatch[2]);
  return { start: `${selectedMonth}-01`, end: `${selectedMonth}-${String(daysInMonth(year, month)).padStart(2, "0")}` };
}

export function getIsraelDateOnly(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
