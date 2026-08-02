import { SettingsPage as SettingsFeaturePage } from "@/features/settings";
import { requireUser } from "@/lib/auth/user";

export default async function SettingsPage() {
  const claims = await requireUser();
  const metadata = claims.app_metadata as { role?: unknown } | undefined;
  const userMetadata = claims.user_metadata as { role?: unknown } | undefined;
  return <SettingsFeaturePage isManager={(metadata?.role ?? userMetadata?.role) === "manager"} />;
}
