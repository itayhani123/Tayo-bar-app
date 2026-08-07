import { DashboardPage as DashboardFeaturePage, type DashboardAccess } from "@/features/dashboard";
import { requireCurrentUser } from "@/lib/auth/user";
export default async function DashboardPage() { const { role } = await requireCurrentUser(); return <DashboardFeaturePage access={role satisfies DashboardAccess} />; }
