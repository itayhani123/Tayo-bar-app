import type { AttendanceExtraction } from "./attendance";
export const attendanceExample = `יום חמישי 12/11 קסנאדו
הגעה
נדב פתיחה (16:15)
טל 19:00
גאיה 19:15
עדן 19:15
רועי 19:15
מיכל 19:15
ליה 19:15
נווה 19:40

יציאה
נדב 2:10
טל 02:10
נווה 01:35
עדן 02:05
ליה 02:05
מיכל 02:05
גאיה 02:05
רועי לוי 02:05`;
export const names = ["נדב", "טל", "גאיה", "עדן", "רועי לוי", "מיכל", "ליה", "נווה"];
export const employees = names.map((full_name, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, full_name }));
export const extracted: AttendanceExtraction = {
  venue: "קסנאדו", day: 12, month: 11, year: null, weekday: 4,
  entries: [
    ...["נדב פתיחה", "טל", "גאיה", "עדן", "רועי", "מיכל", "ליה", "נווה"].map((name, i) => ({ name, direction: "in" as const, time: i === 0 ? "16:15" : i === 1 ? "19:00" : i === 7 ? "19:40" : "19:15", note: null })),
    ...["נדב", "טל", "נווה", "עדן", "ליה", "מיכל", "גאיה", "רועי לוי"].map((name, i) => ({ name, direction: "out" as const, time: i === 0 ? "2:10" : i === 1 ? "02:10" : i === 2 ? "01:35" : "02:05", note: null })),
  ],
};
