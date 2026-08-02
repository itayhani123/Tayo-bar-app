import { DashboardPage as DashboardFeaturePage, type DashboardAccess } from "@/features/dashboard";
import { requireUser } from "@/lib/auth/user";

export default async function DashboardPage() {
  const claims = await requireUser();
  const metadata = claims.app_metadata as { role?: unknown } | undefined;
  const userMetadata = claims.user_metadata as { role?: unknown } | undefined;
  const role = metadata?.role ?? userMetadata?.role;
  const access: DashboardAccess = role === "manager" ? "manager" : "owner";
  return <DashboardFeaturePage access={access} />;
}
