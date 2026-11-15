import {attendanceClock,type AttendanceExtraction} from "./attendance";

export class AttendanceInputError extends Error {}
export function attendanceRangeEntries(text:string):AttendanceExtraction["entries"]|null{
 const clocks=text.match(/(?<!\d)\d{1,2}:\d{1,3}(?!\d)/g)||[];
 for(const clock of clocks)try{attendanceClock(clock);}catch{
  throw new AttendanceInputError(`⚠️ השעה "${clock}" אינה תקינה או חד־משמעית. כתבו שעות בפורמט מלא, למשל 17:30 או 17:35, ושלחו את הדיווח המתוקן. לא נשמרו שעות.`);
 }
 const timed=text.split(/\r?\n/).map(line=>line.trim()).filter(line=>/\d{1,2}:\d/.test(line));
 const ranges=timed.map(line=>/^(.+?)\s+(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\s*$/.exec(line));
 if(!ranges.length||ranges.some(match=>!match))return null;
 return ranges.flatMap(match=>[
  {name:match![1],time:attendanceClock(match![2]),direction:"in" as const,note:null},
  {name:match![1],time:attendanceClock(match![3]),direction:"out" as const,note:null},
 ]);
}
