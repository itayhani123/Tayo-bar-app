import { ReportsPage as ReportsFeaturePage } from "@/features/reports";
import { requireUser } from "@/lib/auth/user";

export default async function ReportsPage() {
  const claims = await requireUser();
  const appMetadata = claims.app_metadata as { role?: unknown } | undefined;
  const userMetadata = claims.user_metadata as { role?: unknown } | undefined;
  const role = appMetadata?.role ?? userMetadata?.role;
  return <ReportsFeaturePage isManager={role === "manager"} />;
}
