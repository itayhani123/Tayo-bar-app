const ISRAEL_TIME_ZONE = "Asia/Jerusalem";

export function eventInstant(eventDate: string, eventTime: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
  const time = /^(\d{2}):(\d{2})/.exec(eventTime);
  if (!match || !time) throw new Error("Invalid event date or time");
  const utcGuess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(time[1]), Number(time[2]));
  const firstOffset = israelOffsetMinutes(new Date(utcGuess));
  const candidate = new Date(utcGuess - firstOffset * 60_000);
  const finalOffset = israelOffsetMinutes(candidate);
  return new Date(utcGuess - finalOffset * 60_000);
}

export function reminderSchedule(eventDate: string, eventTime: string, hoursBefore: number, now = new Date()): Date | null {
  const scheduled = new Date(eventInstant(eventDate, eventTime).getTime() - hoursBefore * 3_600_000);
  return scheduled > now ? scheduled : null;
}

export function scheduleChanged(previousDate: string, previousTime: string, nextDate: string, nextTime: string) {
  return previousDate !== nextDate || previousTime.slice(0, 5) !== nextTime.slice(0, 5);
}

export function shouldNotifyWorkTime(previousStart: string | null, previousEnd: string | null, nextStart: string | null, nextEnd: string | null) {
  return Boolean(nextStart && nextEnd && (previousStart !== nextStart || previousEnd !== nextEnd));
}

function israelOffsetMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ISRAEL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour), Number(map.minute), Number(map.second));
  return Math.round((asUtc - date.getTime()) / 60_000);
}
