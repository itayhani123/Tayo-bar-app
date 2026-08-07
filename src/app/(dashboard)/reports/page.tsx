import { ReportsPage as ReportsFeaturePage } from "@/features/reports";
import { requireOwner } from "@/lib/auth/user";
export default async function ReportsPage() { await requireOwner(); return <ReportsFeaturePage isManager={false} />; }
