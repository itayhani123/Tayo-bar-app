import { AppShell } from "@/components/layout/app-shell";
import { requireCurrentUser } from "@/lib/auth/user";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { role } = await requireCurrentUser();
  return <AppShell role={role}>{children}</AppShell>;
}
