import { EventsPage as EventsFeaturePage } from "@/features/events";
import { requireUser } from "@/lib/auth/user";

export default async function EventsPage() {
  const claims = await requireUser();
  const appMetadata = claims.app_metadata as { role?: unknown } | undefined;
  const userMetadata = claims.user_metadata as { role?: unknown } | undefined;
  const role = appMetadata?.role ?? userMetadata?.role;
  return <EventsFeaturePage showFinancials={role !== "manager"} />;
}
