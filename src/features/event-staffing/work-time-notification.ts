type WorkTimes = { workStart: string | null; workEnd: string | null };

function sameInstant(left: string | null, right: string | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

export function shouldEnqueueWorkTimeUpdated(previous: WorkTimes, current: WorkTimes) {
  if (!current.workStart || !current.workEnd) return false;
  return !sameInstant(previous.workStart, current.workStart) || !sameInstant(previous.workEnd, current.workEnd);
}

export function workTimeNotificationDedupeSource(assignmentId: string, times: WorkTimes) {
  if (!times.workStart || !times.workEnd) return null;
  return `work_time_updated:${assignmentId}:${new Date(times.workStart).toISOString()}:${new Date(times.workEnd).toISOString()}`;
}
