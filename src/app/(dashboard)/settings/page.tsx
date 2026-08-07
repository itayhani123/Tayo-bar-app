import { SettingsPage as SettingsFeaturePage } from "@/features/settings";
import { requireOwner } from "@/lib/auth/user";
export default async function SettingsPage() { await requireOwner(); return <SettingsFeaturePage isManager={false} />; }
