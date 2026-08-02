import { CalendarPage as CalendarFeaturePage, type CalendarAccess } from "@/features/calendar";
import { requireUser } from "@/lib/auth/user";

export default async function CalendarPage() {
  const claims = await requireUser();
  const metadata = claims.app_metadata as { role?: unknown } | undefined;
  const userMetadata = claims.user_metadata as { role?: unknown } | undefined;
  const role = metadata?.role ?? userMetadata?.role;
  const access: CalendarAccess = role === "manager" ? "manager" : "owner";
  return <CalendarFeaturePage access={access} />;
}
