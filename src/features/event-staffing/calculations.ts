import type { EventAssignment } from "./types";

export function getWorkedMinutes(workStart: string | null, workEnd: string | null): number | null {
  if (!workStart || !workEnd) return null;
  const start = new Date(workStart).getTime();
  let end = new Date(workEnd).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end < start) end += 24 * 60 * 60 * 1000;
  const minutes = Math.round((end - start) / 60000);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

export function getAssignmentSalary(assignment: EventAssignment): number | null {
  if (assignment.payType === "fixed") return assignment.fixedPay;
  const minutes = getWorkedMinutes(assignment.workStart, assignment.workEnd);
  return minutes === null || assignment.hourlyRate === null ? null : (minutes / 60) * assignment.hourlyRate;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} דקות`;
  if (!remainder) return `${hours} שעות`;
  return `${hours} שעות ו־${remainder} דקות`;
}

export function formatAssignmentTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function timeInputValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
