import { ReceivablesPage } from "@/features/receivables";
import { requireOwner } from "@/lib/auth/user";
export default async function Page() { await requireOwner(); return <ReceivablesPage />; }
