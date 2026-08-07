import { CalendarPage as CalendarFeaturePage, type CalendarAccess } from "@/features/calendar";
import { requireCurrentUser } from "@/lib/auth/user";
export default async function CalendarPage() { const { role } = await requireCurrentUser(); return <CalendarFeaturePage access={role satisfies CalendarAccess} />; }
