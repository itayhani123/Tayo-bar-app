import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/user";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  return <AppShell>{children}</AppShell>;
}
