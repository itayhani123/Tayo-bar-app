import { EventsPage as EventsFeaturePage } from "@/features/events";
import { requireCurrentUser } from "@/lib/auth/user";
export default async function EventsPage() { const { role } = await requireCurrentUser(); return <EventsFeaturePage showFinancials={role === "owner"} />; }
